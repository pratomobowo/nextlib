import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { callAgentAnalytics } from "@/lib/agent/agent-client";

/**
 * GET /api/v1/analytics/export?type=top-books|dead-stock|collection|activity&format=csv
 *
 * Fetches the requested analytics dataset from the agent and returns it as a
 * CSV download. The dashboard's "Export CSV" buttons point here.
 *
 * The export runs server-side (the cloud calls the agent), so sensitive
 * params stay off the client. Only CSV is supported initially — Excel (.xlsx)
 * can be added in a later sprint via exceljs.
 */
export async function GET(request: NextRequest) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) {
    return NextResponse.json(
      { error: true, code: "UNAUTHORIZED", message: "Authentication required." },
      { status: 401 }
    );
  }
  const tenantId = sessionUser.user.tenantId;
  if (!tenantId) {
    return NextResponse.json(
      { error: true, code: "FORBIDDEN", message: "No tenant bound to this account." },
      { status: 403 }
    );
  }

  const url = new URL(request.url);
  const type = url.searchParams.get("type") || "top-books";
  const format = (url.searchParams.get("format") || "csv").toLowerCase();

  if (format !== "csv") {
    return NextResponse.json(
      { error: true, code: "INVALID_FORMAT", message: "Only CSV format is supported." },
      { status: 400 }
    );
  }

  // Build agent params from query string (pass-through)
  const params: Record<string, unknown> = {};
  for (const [key, value] of url.searchParams.entries()) {
    if (["type", "format"].includes(key)) continue;
    // Numeric coercion where appropriate
    if (["limit", "months", "months_idle"].includes(key)) {
      params[key] = parseInt(value, 10);
    } else if (key === "include_never") {
      params[key] = value === "true";
    } else {
      params[key] = value;
    }
  }

  const { status, body } = await callAgentAnalytics(
    tenantId,
    AGENT_PATH_BY_TYPE[type] ?? "top-books",
    params
  );

  if (status !== 200) {
    return NextResponse.json(body, { status });
  }

  const csv = toCsv(type, body);
  const filename = `nextlib-${type}-${new Date().toISOString().slice(0, 10)}.csv`;

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

const AGENT_PATH_BY_TYPE: Record<string, string> = {
  "top-books": "top-books",
  "dead-stock": "dead-stock",
  collection: "collection-stats",
  activity: "member-activity",
};

/**
 * Convert an analytics payload (from the agent) to CSV. Each insight type has
 * its own row shape; we flatten the most useful fields.
 */
function toCsv(type: string, payload: unknown): string {
  const p = payload as Record<string, unknown>;
  const rows: string[][] = [];

  switch (type) {
    case "top-books": {
      rows.push(["Rank", "Title", "Classification", "ISBN/ISSN", "Authors", "Loan Count"]);
      const books = (p.books as Array<Record<string, unknown>>) ?? [];
      books.forEach((b, i) => {
        rows.push([
          String(i + 1),
          String(b.title ?? ""),
          String(b.classification ?? ""),
          String(b.isbn_issn ?? ""),
          String(b.author_names ?? ""),
          String(b.loan_count ?? 0),
        ]);
      });
      break;
    }
    case "dead-stock": {
      rows.push(["Item Code", "Title", "Classification", "Last Loan Date", "Status", "Idle Months"]);
      const items = (p.items as Array<Record<string, unknown>>) ?? [];
      items.forEach((it) => {
        rows.push([
          String(it.item_code ?? ""),
          String(it.title ?? ""),
          String(it.classification ?? ""),
          String(it.last_loan_date ?? ""),
          String(it.status ?? ""),
          it.idle_months === null ? "" : String(it.idle_months),
        ]);
      });
      break;
    }
    case "collection": {
      rows.push(["DDC Class", "Label", "Titles", "Items"]);
      const ddc = (p.ddc as Array<Record<string, unknown>>) ?? [];
      ddc.forEach((d) => {
        rows.push([
          String(d.class ?? ""),
          String(d.label ?? ""),
          String(d.titles ?? 0),
          String(d.items ?? 0),
        ]);
      });
      break;
    }
    case "activity": {
      rows.push(["Year-Month", "Loans", "Unique Members"]);
      const trends = (p.trends as Array<Record<string, unknown>>) ?? [];
      trends.forEach((t) => {
        rows.push([
          String(t.ym ?? ""),
          String(t.loans ?? 0),
          String(t.unique_members ?? 0),
        ]);
      });
      break;
    }
    default:
      rows.push(["Error", `Unknown export type: ${type}`]);
  }

  return rows.map(escapeCsvRow).join("\n");
}

/** Escape a single CSV row. Quotes fields containing commas/quotes/newlines. */
function escapeCsvRow(fields: string[]): string {
  return fields
    .map((f) => {
      if (/[",\n]/.test(f)) {
        return `"${f.replace(/"/g, '""')}"`;
      }
      return f;
    })
    .join(",");
}
