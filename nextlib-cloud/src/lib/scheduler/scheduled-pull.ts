import { Worker, type Job, Queue } from "bullmq";
import { eq } from "drizzle-orm";
import { redisConnection } from "@/lib/whatsapp/message-queue";
import { db } from "@/lib/db";
import { tenants } from "@/lib/db/schema";
import { pullAgentDailyAggregate } from "@/lib/agent/agent-client";
import { bulkUpsertDailyStatsV2, updateTenantPullStatus } from "@/lib/analytics/daily-stats-bulk";

/** BullMQ queue name for the daily scheduled pull. */
export const SCHEDULED_PULL_QUEUE = "scheduled-pull";

/** Job data — empty, the worker iterates all connected tenants. */
export interface ScheduledPullJobData {
  /** ISO date string of when this run started, for logging. */
  startedAt: string;
}

/** Cron pattern for the daily scheduled pull. Configurable via env. */
const PULL_CRON = process.env.SCHEDULED_PULL_CRON ?? "0 2 * * *";
const PULL_LOOKBACK_DAYS = 7;

/**
 * Process one scheduled pull job: for every connected tenant, pull
 * the last PULL_LOOKBACK_DAYS days of metrics, bulk-upsert into
 * daily_stats_v2, and update the tenant's lastPullAt/Status.
 *
 * Failures are isolated per-tenant — one broken tenant doesn't stop
 * the others from being pulled.
 */
export async function runScheduledPull(): Promise<void> {
  const encryptionKey = process.env.AES_256_ENCRYPTION_KEY;
  if (!encryptionKey) {
    console.error("[ScheduledPull] AES_256_ENCRYPTION_KEY is not configured; skipping run");
    return;
  }

  const tenantRows = await db
    .select({
      id: tenants.id,
      slimsBaseUrl: tenants.slimsBaseUrl,
      apiSecretEncrypted: tenants.apiSecretEncrypted,
    })
    .from(tenants)
    .where(eq(tenants.status, "connected"));

  console.log(`[ScheduledPull] Found ${tenantRows.length} connected tenant(s) to pull`);

  const today = new Date();
  const startDate = new Date(today);
  startDate.setUTCDate(startDate.getUTCDate() - (PULL_LOOKBACK_DAYS - 1));
  const startStr = startDate.toISOString().slice(0, 10);
  const endStr = today.toISOString().slice(0, 10);

  for (const tenant of tenantRows) {
    try {
      const result = await pullAgentDailyAggregate(
        tenant,
        startStr,
        endStr,
        encryptionKey
      );

      if (!result.success || !result.days) {
        await updateTenantPullStatus(tenant.id, "failed", result.error ?? "Unknown error");
        console.warn(`[ScheduledPull] Tenant ${tenant.id} pull failed: ${result.error}`);
        continue;
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
      const upsertResult = await bulkUpsertDailyStatsV2(tenant.id, upsertDays);
      await updateTenantPullStatus(tenant.id, "ok");
      console.log(
        `[ScheduledPull] Tenant ${tenant.id}: upserted ${upsertResult.rowsAffected} day(s) for ${startStr}..${endStr}`
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await updateTenantPullStatus(tenant.id, "failed", msg);
      console.error(`[ScheduledPull] Tenant ${tenant.id} threw:`, msg);
    }
  }
}

/**
 * BullMQ worker for the scheduled pull. The actual schedule is set
 * by the queue (see ensureScheduledPullRegistered below). The worker
 * just processes whatever the queue feeds it.
 */
export function createScheduledPullWorker(): Worker<ScheduledPullJobData> {
  const worker = new Worker<ScheduledPullJobData>(
    SCHEDULED_PULL_QUEUE,
    async (_job: Job<ScheduledPullJobData>) => {
      await runScheduledPull();
    },
    {
      connection: redisConnection,
      concurrency: 1,
      limiter: {
        // Don't hammer the agent if a previous run was delayed
        max: 1,
        duration: 60_000,
      },
    }
  );

  worker.on("completed", (job) => {
    console.log(`[ScheduledPull] Job ${job.id} completed`);
  });

  worker.on("failed", (job, err) => {
    console.error(`[ScheduledPull] Job ${job?.id} failed:`, err.message);
  });

  console.log("[ScheduledPull] Scheduled-pull worker started");
  return worker;
}

/**
 * Set up the repeatable scheduled pull job. Call this once at
 * worker boot. Safe to call multiple times — BullMQ's
 * `upsertJobScheduler` handles dedup.
 */
export async function ensureScheduledPullRegistered(): Promise<void> {
  const queue = new Queue<ScheduledPullJobData>(SCHEDULED_PULL_QUEUE, {
    connection: redisConnection,
  });
  await queue.upsertJobScheduler(
    "daily-pull",
    { pattern: PULL_CRON, tz: "UTC" },
    {
      name: "daily-pull",
      data: { startedAt: new Date().toISOString() },
    }
  );
  await queue.close();
  console.log(`[ScheduledPull] Daily pull registered with cron: ${PULL_CRON}`);
}
