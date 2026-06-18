import { Worker } from "bullmq";
import { eq } from "drizzle-orm";
import { redisConnection } from "@/lib/whatsapp/message-queue";
import { BACKFILL_QUEUE, type BackfillJobData } from "./backfill-queue";
import { db } from "@/lib/db";
import { backfillJobs, tenants } from "@/lib/db/schema";
import { pullAgentDailyAggregate } from "@/lib/agent/agent-client";
import { bulkUpsertDailyStatsV2, updateTenantPullStatus } from "@/lib/analytics/daily-stats-bulk";

/**
 * BullMQ worker that drives historical backfill by pulling from
 * the agent in 90-day chunks. Each chunk is one HTTP call to
 * /api/v1/nextlib/daily-aggregate, then a single bulk upsert.
 *
 * Pipeline per job:
 *   1. Mark the `backfill_jobs` row as `running`.
 *   2. Split [dateStart, dateEnd] into ≤90-day chunks.
 *   3. For each chunk: pullAgentDailyAggregate → bulkUpsert.
 *   4. Update processedDays / lastProcessedDate.
 *   5. Cancelled jobs bail out cleanly.
 *   6. Set status to `completed` (or `failed` if every chunk failed).
 */

const CONCURRENCY = 1;
const CHUNK_DAYS = 90;
const PER_CHUNK_DELAY_MS = 250;
const PROGRESS_FLUSH_EVERY = 1;

export function createBackfillWorker(): Worker<BackfillJobData> {
  const worker = new Worker<BackfillJobData>(
    BACKFILL_QUEUE,
    async (job) => {
      const { jobId, tenantId, dateStart, dateEnd } = job.data;
      console.log(`[Backfill] Starting job ${jobId} for tenant ${tenantId}: ${dateStart} → ${dateEnd}`);

      const encryptionKey = process.env.AES_256_ENCRYPTION_KEY;
      if (!encryptionKey) {
        await markFailed(jobId, "AES_256_ENCRYPTION_KEY is not configured");
        throw new Error("AES_256_ENCRYPTION_KEY is not configured");
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
        await markFailed(jobId, `Tenant ${tenantId} not found`);
        throw new Error(`Tenant ${tenantId} not found`);
      }
      const tenant = tenantRows[0];

      await db
        .update(backfillJobs)
        .set({ status: "running", startedAt: new Date(), updatedAt: new Date() })
        .where(eq(backfillJobs.id, jobId));

      const chunks = buildChunks(dateStart, dateEnd, CHUNK_DAYS);
      let processedChunks = 0;
      let failedChunks = 0;
      let totalDaysImported = 0;
      let lastError: string | null = null;
      let lastProcessedDate: string | null = null;

      for (const chunk of chunks) {
        // Cancellation check
        const current = await db
          .select({ status: backfillJobs.status })
          .from(backfillJobs)
          .where(eq(backfillJobs.id, jobId))
          .limit(1);
        if (current[0]?.status === "cancelled") {
          console.log(`[Backfill] Job ${jobId} cancelled at ${chunk.start}`);
          break;
        }

        try {
          const result = await pullAgentDailyAggregate(tenant, chunk.start, chunk.end, encryptionKey);
          if (!result.success || !result.days) {
            failedChunks++;
            lastError = result.error ?? `Failed for ${chunk.start}..${chunk.end}`;
            console.warn(`[Backfill] ${jobId} ${chunk.start}..${chunk.end} failed: ${lastError}`);
          } else {
            if (result.days.length > 0) {
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
              totalDaysImported += upsert.rowsAffected;
            }
            lastProcessedDate = chunk.end;
          }
        } catch (err) {
          failedChunks++;
          lastError = err instanceof Error ? err.message : String(err);
          console.error(`[Backfill] ${jobId} ${chunk.start}..${chunk.end} threw:`, lastError);
        }

        processedChunks++;
        if (processedChunks % PROGRESS_FLUSH_EVERY === 0) {
          await db
            .update(backfillJobs)
            .set({
              processedDays: totalDaysImported,
              failedDays: failedChunks,
              lastProcessedDate,
              lastError,
              updatedAt: new Date(),
            })
            .where(eq(backfillJobs.id, jobId));
        }

        if (PER_CHUNK_DELAY_MS > 0) {
          await sleep(PER_CHUNK_DELAY_MS);
        }
      }

      const finalStatus = failedChunks === processedChunks && processedChunks > 0 ? "failed" : "completed";
      await updateTenantPullStatus(tenantId, finalStatus === "completed" ? "ok" : "partial", lastError ?? undefined);
      await db
        .update(backfillJobs)
        .set({
          status: finalStatus,
          processedDays: totalDaysImported,
          failedDays: failedChunks,
          lastProcessedDate,
          lastError,
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(backfillJobs.id, jobId));

      console.log(
        `[Backfill] Job ${jobId} done: status=${finalStatus} imported=${totalDaysImported} failedChunks=${failedChunks}`
      );
    },
    {
      connection: redisConnection,
      concurrency: CONCURRENCY,
      limiter: { max: 4, duration: 5000 },
    }
  );

  worker.on("completed", (job) => console.log(`[Backfill] Job ${job.id} completed`));
  worker.on("failed", (job, err) => console.error(`[Backfill] Job ${job?.id} failed:`, err.message));
  worker.on("error", (err) => console.error("[Backfill] Worker error:", err));

  console.log("[Backfill] Backfill worker started");
  return worker;
}

interface ChunkRange {
  start: string;
  end: string;
}

function buildChunks(start: string, end: string, chunkDays: number): ChunkRange[] {
  const out: ChunkRange[] = [];
  const s = new Date(start + "T00:00:00Z");
  const e = new Date(end + "T00:00:00Z");
  let cursor = new Date(s);
  while (cursor <= e) {
    const chunkEnd = new Date(cursor);
    chunkEnd.setUTCDate(chunkEnd.getUTCDate() + chunkDays - 1);
    if (chunkEnd > e) chunkEnd.setTime(e.getTime());
    out.push({
      start: cursor.toISOString().slice(0, 10),
      end: chunkEnd.toISOString().slice(0, 10),
    });
    cursor = new Date(chunkEnd);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

async function markFailed(jobId: string, message: string): Promise<void> {
  await db
    .update(backfillJobs)
    .set({
      status: "failed",
      lastError: message,
      completedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(backfillJobs.id, jobId));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
