import { NextResponse } from "next/server";
import { z } from "zod/v4";
import { eq, desc, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { backfillJobs } from "@/lib/db/schema";
import { getSessionUser } from "@/lib/auth/session";
import { backfillQueue } from "@/lib/backfill/backfill-queue";

/** Maximum span a single backfill job can cover: 5 years (1825 days). */
const MAX_BACKFILL_DAYS = 1825;

const startSchema = z.object({
  date_start: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "date_start must be YYYY-MM-DD"),
  date_end: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "date_end must be YYYY-MM-DD"),
});

/**
 * POST /api/v1/backfill/start
 *
 * Enqueue a historical data backfill job for the authenticated tenant.
 *
 * Body: { date_start, date_end } — both inclusive.
 *
 * Validation:
 *   - date_start <= date_end
 *   - Range <= MAX_BACKFILL_DAYS
 *   - No other job for this tenant is currently pending/running
 *
 * Auth: any logged-in user bound to a tenant (tenant_admin / librarian).
 * super_admin without a tenant gets 403.
 */
export async function POST(request: Request) {
  const sessionUser = await getSessionUser();
  if (!sessionUser) {
    return NextResponse.json(
      { error: true, code: "UNAUTHORIZED", message: "Authentication required." },
      { status: 401 }
    );
  }

  const { user } = sessionUser;
  const tenantId = user.tenantId;
  if (!tenantId) {
    return NextResponse.json(
      {
        error: true,
        code: "FORBIDDEN",
        message: "Your account is not bound to a tenant.",
      },
      { status: 403 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: true, code: "INVALID_JSON", message: "Request body is not valid JSON." },
      { status: 400 }
    );
  }

  const parsed = startSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: true,
        code: "VALIDATION_ERROR",
        message: "Invalid input",
        details: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      },
      { status: 400 }
    );
  }

  const { date_start, date_end } = parsed.data;

  // Range sanity checks
  if (new Date(date_start) > new Date(date_end)) {
    return NextResponse.json(
      { error: true, code: "INVALID_RANGE", message: "date_start must be <= date_end." },
      { status: 400 }
    );
  }
  const dayCount = Math.floor(
    (Date.parse(date_end) - Date.parse(date_start)) / 86_400_000
  ) + 1;
  if (dayCount > MAX_BACKFILL_DAYS) {
    return NextResponse.json(
      {
        error: true,
        code: "RANGE_TOO_LARGE",
        message: `Range exceeds the ${MAX_BACKFILL_DAYS}-day limit (${dayCount} days requested).`,
      },
      { status: 400 }
    );
  }

  // Prevent stacking parallel jobs for the same tenant
  const active = await db
    .select({ id: backfillJobs.id })
    .from(backfillJobs)
    .where(
      sql`${backfillJobs.tenantId} = ${tenantId} AND ${backfillJobs.status} IN ('pending', 'running')`
    )
    .limit(1);
  if (active.length > 0) {
    return NextResponse.json(
      {
        error: true,
        code: "JOB_ALREADY_RUNNING",
        message: "A backfill is already pending or running for this tenant.",
      },
      { status: 409 }
    );
  }

  // Insert the job row, then enqueue
  const [row] = await db
    .insert(backfillJobs)
    .values({
      tenantId,
      status: "pending",
      dateStart: date_start,
      dateEnd: date_end,
      totalDays: dayCount,
    })
    .returning({ id: backfillJobs.id });

  await backfillQueue.add(
    `backfill:${row.id}`,
    { jobId: row.id, tenantId, dateStart: date_start, dateEnd: date_end },
    { jobId: row.id }
  );

  return NextResponse.json(
    { jobId: row.id, status: "pending", totalDays: dayCount },
    { status: 202 }
  );
}

/**
 * GET /api/v1/backfill/start
 *
 * Convenience alias for the latest job status. The dashboard primarily uses
 * GET /api/v1/backfill/status, but this is here so a single endpoint can be
 * polled after triggering a start.
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
  return NextResponse.json({ job: serializeJob(rows[0]) });
}

/** Shape the row for the dashboard client. */
function serializeJob(row: typeof backfillJobs.$inferSelect) {
  const percent =
    row.totalDays > 0 ? Math.round((row.processedDays / row.totalDays) * 100) : 0;
  return {
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
  };
}

/** Coerce a Drizzle date column value (string | Date | null) to YYYY-MM-DD | null. */
function normalizeDate(value: string | Date | null): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return value;
}
