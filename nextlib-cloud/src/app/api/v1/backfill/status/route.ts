import { NextResponse } from "next/server";
import { eq, desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { backfillJobs } from "@/lib/db/schema";
import { getSessionUser } from "@/lib/auth/session";

/**
 * GET /api/v1/backfill/status
 *
 * Returns the latest backfill job for the authenticated tenant. Used by the
 * dashboard for live progress polling.
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
    .limit(1);

  if (rows.length === 0) {
    return NextResponse.json({ job: null });
  }

  const row = rows[0];
  const percent =
    row.totalDays > 0 ? Math.round((row.processedDays / row.totalDays) * 100) : 0;
  return NextResponse.json({
    job: {
      id: row.id,
      status: row.status,
      dateStart: normalizeDate(row.dateStart),
      dateEnd: normalizeDate(row.dateEnd),
      totalDays: row.totalDays,
      processedDays: row.processedDays,
      failedDays: row.failedDays,
      percent,
      lastProcessedDate: normalizeDate(row.lastProcessedDate),
      lastError: row.lastError,
      startedAt: row.startedAt,
      completedAt: row.completedAt,
      createdAt: row.createdAt,
    },
  });
}

/** Coerce a Drizzle date column value (string | Date | null) to YYYY-MM-DD | null. */
function normalizeDate(value: string | Date | null): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return value;
}
