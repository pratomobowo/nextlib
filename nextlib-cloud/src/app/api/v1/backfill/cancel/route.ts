import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { backfillJobs } from "@/lib/db/schema";
import { getSessionUser } from "@/lib/auth/session";

/**
 * POST /api/v1/backfill/cancel
 *
 * Marks the tenant's currently running/pending backfill job as `cancelled`.
 * The worker polls the status between dates and stops when it sees this.
 *
 * Body: { jobId?: string } — if omitted, cancels the most recent active job.
 */
export async function POST(request: Request) {
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

  let jobId: string | undefined;
  try {
    const body = (await request.json()) as { jobId?: string };
    jobId = body.jobId;
  } catch {
    // body optional — fall through to "latest active job" lookup
  }

  let targetId: string;
  if (jobId) {
    // Verify the job belongs to this tenant before cancelling
    const rows = await db
      .select({ id: backfillJobs.id, status: backfillJobs.status })
      .from(backfillJobs)
      .where(and(eq(backfillJobs.id, jobId), eq(backfillJobs.tenantId, tenantId)))
      .limit(1);
    if (rows.length === 0) {
      return NextResponse.json(
        { error: true, code: "NOT_FOUND", message: "Job not found for this tenant." },
        { status: 404 }
      );
    }
    if (!["pending", "running"].includes(rows[0].status)) {
      return NextResponse.json(
        {
          error: true,
          code: "NOT_CANCELLABLE",
          message: `Job is already ${rows[0].status}.`,
        },
        { status: 409 }
      );
    }
    targetId = rows[0].id;
  } else {
    // Find the latest pending/running job for this tenant
    const rows = await db
      .select({ id: backfillJobs.id })
      .from(backfillJobs)
      .where(
        and(
          eq(backfillJobs.tenantId, tenantId),
          eq(backfillJobs.status, "running")
        )
      )
      .limit(1);
    if (rows.length === 0) {
      // Also check pending
      const pendingRows = await db
        .select({ id: backfillJobs.id })
        .from(backfillJobs)
        .where(
          and(
            eq(backfillJobs.tenantId, tenantId),
            eq(backfillJobs.status, "pending")
          )
        )
        .limit(1);
      if (pendingRows.length === 0) {
        return NextResponse.json(
          { error: true, code: "NO_ACTIVE_JOB", message: "No pending or running backfill to cancel." },
          { status: 404 }
        );
      }
      targetId = pendingRows[0].id;
    } else {
      targetId = rows[0].id;
    }
  }

  await db
    .update(backfillJobs)
    .set({ status: "cancelled", updatedAt: new Date(), completedAt: new Date() })
    .where(eq(backfillJobs.id, targetId));

  return NextResponse.json({ jobId: targetId, status: "cancelled" });
}
