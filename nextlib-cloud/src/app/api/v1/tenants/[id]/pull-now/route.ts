import { NextResponse } from "next/server";
import { z } from "zod/v4";
import { db } from "@/lib/db";
import { tenants } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getSessionUser } from "@/lib/auth/session";
import { checkTenantAccess } from "@/lib/tenant-access-guard";
import { decrypt } from "@/lib/crypto";
import { pullAgentDailyAggregate } from "@/lib/agent/agent-client";
import { bulkUpsertDailyStatsV2, updateTenantPullStatus } from "@/lib/analytics/daily-stats-bulk";

const pullNowSchema = z.object({
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  mode: z.enum(["immediate", "backfill"]).default("immediate"),
});

const MAX_RANGE_DAYS = 366;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  // 1. Auth
  const sessionUser = await getSessionUser();
  if (!sessionUser) {
    return NextResponse.json(
      { error: true, code: "UNAUTHORIZED", message: "Authentication required" },
      { status: 401 }
    );
  }

  const { id: tenantId } = await params;
  const access = checkTenantAccess(sessionUser.user as any, tenantId);
  if (!access.allowed) {
    return NextResponse.json(
      { error: true, code: access.code, message: access.message },
      { status: access.status }
    );
  }

  // 2. Parse + validate body
  let payload: z.infer<typeof pullNowSchema>;
  try {
    const raw = await request.json();
    payload = pullNowSchema.parse(raw);
  } catch (err) {
    return NextResponse.json(
      { error: true, code: "VALIDATION_ERROR", message: "Invalid request body", detail: String(err) },
      { status: 400 }
    );
  }

  // 3. Range check
  const s = new Date(payload.start_date);
  const e = new Date(payload.end_date);
  if (s > e || (e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24) > MAX_RANGE_DAYS) {
    return NextResponse.json(
      { error: true, code: "INVALID_DATE_RANGE", message: `Range must be ≤ ${MAX_RANGE_DAYS} days and start ≤ end` },
      { status: 400 }
    );
  }

  // 4. Backfill mode → enqueue, return 202
  if (payload.mode === "backfill") {
    const { backfillQueue } = await import("@/lib/backfill/backfill-queue");
    const { backfillJobs } = await import("@/lib/db/schema");
    const jobId = crypto.randomUUID();
    await db.insert(backfillJobs).values({
      id: jobId,
      tenantId,
      dateStart: payload.start_date,
      dateEnd: payload.end_date,
      totalDays: Math.floor((e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24)) + 1,
      status: "pending",
    });
    await backfillQueue.add("backfill", {
      jobId,
      tenantId,
      dateStart: payload.start_date,
      dateEnd: payload.end_date,
    });
    return NextResponse.json({ job_id: jobId, mode: "backfill" }, { status: 202 });
  }

  // 5. Immediate mode → call agent, upsert, return stats
  const encryptionKey = process.env.AES_256_ENCRYPTION_KEY;
  if (!encryptionKey) {
    return NextResponse.json(
      { error: true, code: "SERVER_ERROR", message: "Encryption key not configured" },
      { status: 500 }
    );
  }

  const tenantRows = await db
    .select({
      slimsBaseUrl: tenants.slimsBaseUrl,
      apiSecretEncrypted: tenants.apiSecretEncrypted,
    })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);

  if (tenantRows.length === 0) {
    return NextResponse.json(
      { error: true, code: "TENANT_NOT_FOUND", message: "Tenant not found" },
      { status: 404 }
    );
  }

  // Decrypt to compute keyHash for header
  let apiSecret: string;
  try {
    apiSecret = decrypt(tenantRows[0].apiSecretEncrypted, encryptionKey);
  } catch {
    return NextResponse.json(
      { error: true, code: "SERVER_ERROR", message: "Failed to decrypt tenant credentials" },
      { status: 500 }
    );
  }

  const result = await pullAgentDailyAggregate(
    { slimsBaseUrl: tenantRows[0].slimsBaseUrl, apiSecretEncrypted: tenantRows[0].apiSecretEncrypted },
    payload.start_date,
    payload.end_date,
    encryptionKey
  );

  if (!result.success || !result.days) {
    await updateTenantPullStatus(tenantId, "failed", result.error);
    return NextResponse.json(
      { error: true, code: "AGENT_UNREACHABLE", message: result.error ?? "Pull failed" },
      { status: 503 }
    );
  }

  const upsertDays = result.days.map((d) => ({
    date: d.date,
    visitorCount: d.daily_metrics.visitor_count,
    uniqueVisitorCount: d.daily_metrics.unique_visitor_count,
    loanCount: d.daily_metrics.loan_count,
    returnCount: d.daily_metrics.return_count,
    newMemberCount: d.daily_metrics.new_member_count,
    newBiblioCount: d.daily_metrics.new_biblio_count,
    newItemCount: d.daily_metrics.new_item_count,
    finesDebetTotal: d.daily_metrics.fines_debet_total,
    finesCreditTotal: d.daily_metrics.fines_credit_total,
    reservationCount: d.daily_metrics.reservation_count,
    totalCollectionSize: d.snapshot_metrics.total_collection_size,
    activeMemberCount: d.snapshot_metrics.active_member_count,
    activeOverdueCount: d.snapshot_metrics.active_overdue_count,
    anomalyFlags: d.anomaly_flags,
  }));
  const upsert = await bulkUpsertDailyStatsV2(tenantId, upsertDays);
  await updateTenantPullStatus(tenantId, "ok");

  return NextResponse.json({
    days_imported: result.days.length,
    rows_affected: upsert.rowsAffected,
    start_date: payload.start_date,
    end_date: payload.end_date,
  });
}
