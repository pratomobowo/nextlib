import { NextResponse } from "next/server";
import { eq, desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { backfillJobs } from "@/lib/db/schema";
import { getSessionUser } from "@/lib/auth/session";

/**
 * GET /api/v1/backfill/jobs
 *
 * Returns the last 20 backfill jobs for the authenticated tenant (history).
 */
export async function GET() {
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

  const rows = await db
    .select()
    .from(backfillJobs)
    .where(eq(backfillJobs.tenantId, tenantId))
    .orderBy(desc(backfillJobs.createdAt))
    .limit(20);

  const jobs = rows.map((row) => ({
    id: row.id,
    status: row.status,
    dateStart: normalizeDate(row.dateStart),
    dateEnd: normalizeDate(row.dateEnd),
    totalDays: row.totalDays,
    processedDays: row.processedDays,
    failedDays: row.failedDays,
    lastError: row.lastError,
    createdAt: row.createdAt,
    completedAt: row.completedAt,
  }));

  return NextResponse.json({ jobs });
}

/** Coerce a Drizzle date column value (string | Date | null) to YYYY-MM-DD | null. */
function normalizeDate(value: string | Date | null): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return value;
}
