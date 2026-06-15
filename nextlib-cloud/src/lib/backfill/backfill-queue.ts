import { Queue } from "bullmq";
import { redisConnection } from "@/lib/whatsapp/message-queue";

/**
 * BullMQ queue for cloud-driven historical data backfill.
 *
 * Producers: the `POST /api/v1/backfill/start` route enqueues one job per
 * user request. Consumer: `createBackfillWorker` in backfill-worker.ts.
 *
 * Concurrency model:
 *   - One active job per tenant is enforced by using `tenantId` as the BullMQ
 *     job group (so a tenant can't accidentally stack parallel backfills).
 *   - The worker further rate-limits per-tenant requests to be gentle on the
 *     campus SLiMS database (see `limiter` in backfill-worker.ts).
 */

/** BullMQ queue name. v5 forbids `:` in names — hyphenated only. */
export const BACKFILL_QUEUE = "backfill";

/** Job data carried on the backfill queue. */
export interface BackfillJobData {
  /** UUID of the `backfill_jobs` row tracking this run. */
  jobId: string;
  /** Tenant the backfill is scoped to. */
  tenantId: string;
  /** Inclusive start date in `YYYY-MM-DD`. */
  dateStart: string;
  /** Inclusive end date in `YYYY-MM-DD`. */
  dateEnd: string;
}

/**
 * The backfill queue. Reuses the same Redis connection as the WhatsApp queue.
 */
export const backfillQueue = new Queue<BackfillJobData>(BACKFILL_QUEUE, {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 1, // The worker handles per-date retry internally; one shot.
    backoff: { type: "exponential", delay: 5000 },
    removeOnComplete: { count: 200, age: 86400 * 7 },
    removeOnFail: { count: 200, age: 86400 * 30 },
  },
});
