import { Worker } from "bullmq";
import { eq, sql } from "drizzle-orm";
import { redisConnection } from "@/lib/whatsapp/message-queue";
import { BACKFILL_QUEUE, type BackfillJobData } from "./backfill-queue";
import { db } from "@/lib/db";
import { backfillJobs, tenants } from "@/lib/db/schema";
import { triggerAgentExport } from "@/lib/agent/agent-client";

/**
 * BullMQ worker that drives a historical backfill by calling the agent's
 * `trigger_export` endpoint once per date in the requested range.
 *
 * Pipeline per job:
 *   1. Mark the `backfill_jobs` row as `running`.
 *   2. Iterate every date from dateStart to dateEnd (inclusive).
 *   3. For each date, POST trigger_export to the agent; the agent then runs
 *      its export logic and POSTs the v1/v2 payloads back to the cloud's
 *      aggregate endpoints (which handle 409 = already-imported as success).
 *   4. After each date, update processedDays / lastProcessedDate so the
 *      dashboard progress bar tracks in near-real-time.
 *   5. A failed date is recorded in failedDays + lastError but does NOT halt
 *      the run — the rest of the range is still attempted.
 *   6. Set status to `completed` (or `failed` if every date failed).
 *
 * Concurrency: BullMQ processes one backfill job at a time per worker
 * process; the dashboard should prevent enqueuing a second job for a tenant
 * that already has one running. The per-tenant rate limiter (below) keeps
 * the agent / SLiMS from being hammered.
 */

/** Cap parallel in-flight trigger_export calls per worker. */
const CONCURRENCY = 1;

/**
 * Pause between dates (ms). Keeps the agent's per-date SLiMS queries from
 * stacking up back-to-back. ~250ms is gentle yet still finishes 5 years of
 * daily data in well under an hour.
 */
const PER_DATE_DELAY_MS = 250;

/**
 * Update the progress row every N processed dates. Avoids writing to the DB
 * on every single date for large ranges.
 */
const PROGRESS_FLUSH_EVERY = 5;

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

      // Load tenant credentials
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

      // Mark running
      await db
        .update(backfillJobs)
        .set({ status: "running", startedAt: new Date(), updatedAt: new Date() })
        .where(eq(backfillJobs.id, jobId));

      // Build the list of dates to process
      const dates = enumerateDates(dateStart, dateEnd);
      let processed = 0;
      let failed = 0;
      let lastError: string | null = null;
      let lastProcessedDate: string | null = null;

      for (const date of dates) {
        // Honour cancellation: if status flipped to `cancelled` externally,
        // stop processing and leave the row as-is.
        const current = await db
          .select({ status: backfillJobs.status })
          .from(backfillJobs)
          .where(eq(backfillJobs.id, jobId))
          .limit(1);
        if (current[0]?.status === "cancelled") {
          console.log(`[Backfill] Job ${jobId} cancelled at ${date}`);
          break;
        }

        const result = await triggerAgentExport(tenant, date, encryptionKey);
        processed++;
        if (!result.success) {
          failed++;
          lastError = result.error ?? `Failed for ${date}`;
          console.warn(`[Backfill] ${jobId} ${date} failed: ${lastError}`);
        } else {
          lastProcessedDate = date;
        }

        // Flush progress periodically
        if (processed % PROGRESS_FLUSH_EVERY === 0) {
          await db
            .update(backfillJobs)
            .set({
              processedDays: processed,
              failedDays: failed,
              lastProcessedDate,
              lastError,
              updatedAt: new Date(),
            })
            .where(eq(backfillJobs.id, jobId));
        }

        // Gentle pacing
        if (PER_DATE_DELAY_MS > 0) {
          await sleep(PER_DATE_DELAY_MS);
        }
      }

      // Final flush + status
      const finalStatus = failed === processed && processed > 0 ? "failed" : "completed";
      await db
        .update(backfillJobs)
        .set({
          status: finalStatus,
          processedDays: processed,
          failedDays: failed,
          lastProcessedDate,
          lastError,
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(backfillJobs.id, jobId));

      console.log(
        `[Backfill] Job ${jobId} done: status=${finalStatus} processed=${processed} failed=${failed}`
      );
    },
    {
      connection: redisConnection,
      concurrency: CONCURRENCY,
      limiter: {
        // Max 4 backfill iterations per 5s — keeps the agent breathing room.
        max: 4,
        duration: 5000,
      },
    }
  );

  worker.on("completed", (job) => {
    console.log(`[Backfill] Job ${job.id} completed`);
  });

  worker.on("failed", (job, err) => {
    console.error(`[Backfill] Job ${job?.id} failed:`, err.message);
  });

  worker.on("error", (err) => {
    console.error("[Backfill] Worker error:", err);
  });

  console.log("[Backfill] Backfill worker started");
  return worker;
}

/** Helper: enumerate every YYYY-MM-DD between start and end (inclusive). */
function enumerateDates(start: string, end: string): string[] {
  const out: string[] = [];
  const s = new Date(start + "T00:00:00Z");
  const e = new Date(end + "T00:00:00Z");
  for (let d = new Date(s); d <= e; d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

/** Helper: mark a job as failed in the DB. */
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
