import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { callAgentAnalytics } from "@/lib/agent/agent-client";

/**
 * GET /api/v1/analytics/dead-stock
 *
 * Returns items never borrowed or idle beyond a threshold. Query params:
 * months_idle (default 12), limit (default 50), include_never (default true).
 */
export async function GET(request: Request) {
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
  const params: Record<string, unknown> = {};
  const monthsIdle = url.searchParams.get("months_idle");
  const limit = url.searchParams.get("limit");
  const includeNever = url.searchParams.get("include_never");
  if (monthsIdle) params.months_idle = parseInt(monthsIdle, 10);
  if (limit) params.limit = parseInt(limit, 10);
  if (includeNever !== null) params.include_never = includeNever === "true";

  const { status, body } = await callAgentAnalytics(tenantId, "dead-stock", params);
  return NextResponse.json(body, { status });
}
