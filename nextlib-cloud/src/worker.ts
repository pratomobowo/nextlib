/**
 * NextLib-Cloud WhatsApp message worker — standalone entry point.
 *
 * This file is NOT part of the Next.js server process. Run it separately:
 *
 *   npm run worker        # dev (tsx)
 *   npm run worker:prod   # production (node dist/worker.js, after build)
 *
 * Why a separate process?
 *   - BullMQ workers are long-lived connections to Redis. Embedding them in
 *     the Next.js server (e.g. via instrumentation.ts) couples message
 *     processing lifetime to web request lifetime and breaks under serverless.
 *   - A dedicated process can be scaled, restarted, and resource-limited
 *     independently from the web tier.
 *   - A worker crash must never take the web server down with it.
 *
 * Required environment (all shared with the web app):
 *   REDIS_URL, DATABASE_URL, AES_256_ENCRYPTION_KEY
 *   WHATSAPP_API_URL (Gowa), optional WHATSAPP_WEBHOOK_SECRET
 *   AI_BASE_URL / AI_API_KEY / AI_MODEL (optional; falls back to keyword heuristics)
 */

import type { Worker } from "bullmq";
import { createMessageWorker } from "@/lib/whatsapp/message-worker";

/** Required env vars — fail loudly with a clear message before booting. */
function assertEnv(): void {
  const required = ["REDIS_URL", "DATABASE_URL", "AES_256_ENCRYPTION_KEY"];
  const missing = required.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    console.error(
      `[Worker] Missing required environment variables: ${missing.join(", ")}. ` +
        "See .env.example for the full list. Exiting."
    );
    process.exit(1);
  }

  if (!process.env.AI_API_KEY) {
    console.warn(
      "[Worker] AI_API_KEY is not set — intent classification and response " +
        "generation will use keyword fallback heuristics."
    );
  }
}

async function main(): Promise<void> {
  assertEnv();
  console.log("[Worker] Booting NextLib WhatsApp message worker...");

  let worker: Worker;
  try {
    worker = createMessageWorker();
  } catch (err) {
    console.error("[Worker] Failed to start worker:", err);
    process.exit(1);
  }

  // Graceful shutdown: stop accepting new jobs, wait for in-flight ones.
  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[Worker] Received ${signal}, draining in-flight jobs...`);
    try {
      await worker.close();
      console.log("[Worker] Closed cleanly. Bye.");
      process.exit(0);
    } catch (err) {
      console.error("[Worker] Error during shutdown:", err);
      process.exit(1);
    }
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

void main().catch((err) => {
  console.error("[Worker] Unhandled boot error:", err);
  process.exit(1);
});
