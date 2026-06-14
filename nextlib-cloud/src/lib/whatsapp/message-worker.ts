import { Worker } from "bullmq";
import {
  redisConnection,
  WA_INCOMING_QUEUE,
  type IncomingMessageJob,
} from "@/lib/whatsapp/message-queue";
import { processMessage } from "@/lib/ai/intent-handlers";
import { getContext, addMessage } from "@/lib/ai/conversation-context";
import { db } from "@/lib/db";
import { whatsappSessions, waMessageLog } from "@/lib/db/schema";
import { eq, or } from "drizzle-orm";
import { gowaClient } from "./gowa-client";

/**
 * BullMQ worker that processes incoming WhatsApp messages.
 *
 * Pipeline:
 * 1. Identify tenant from device_id → whatsapp_sessions lookup
 * 2. Load conversation context from Redis (24h TTL, max 10 messages)
 * 3. Run intent classification via LLM (DeepSeek / custom provider)
 * 4. Execute intent handler (FAQ lookup, SLiMS API call, etc.)
 * 5. Format response via LLM into natural Bahasa Indonesia
 * 6. Send response via Gowa client
 * 7. Log anonymized metrics to wa_message_log (no PII)
 * 8. Update conversation context in Redis
 */

const GOWA_URL = process.env.WHATSAPP_API_URL || "http://localhost:3010";

/**
 * Send a text message via Gowa REST API.
 */
async function sendWhatsAppMessage(
  phone: string,
  message: string,
  deviceId: string
): Promise<void> {
  try {
    await gowaClient.sendText(phone, message, deviceId);
  } catch (error) {
    console.error(`[Worker] Error sending WhatsApp message via Gowa (Device: ${deviceId}):`, error);
    throw error;
  }
}

/**
 * Create and start the message processing worker.
 * Call this function from the app's startup to begin processing messages.
 */
export function createMessageWorker(): Worker<IncomingMessageJob> {
  const worker = new Worker<IncomingMessageJob>(
    WA_INCOMING_QUEUE,
    async (job) => {
      const startTime = Date.now();
      const { deviceId, senderJid, messageText, messageId } = job.data;

      console.log(
        `[Worker] Processing message ${messageId} from ${senderJid}`
      );

      let tenantId: string | undefined;
      try {
        // Step 1: Find tenant by device ID (supporting both JID and custom session ID)
        const sessions = await db
          .select()
          .from(whatsappSessions)
          .where(
            or(
              eq(whatsappSessions.deviceId, deviceId),
              eq(whatsappSessions.tenantId, deviceId)
            )
          );

        if (sessions.length === 0) {
          console.warn(
            `[Worker] No session found for device ${deviceId}, skipping`
          );
          return;
        }

        const session = sessions[0];
        tenantId = session.tenantId;

        // Step 2: Load conversation context
        const context = await getContext(senderJid);

        // Step 3 & 4: Process message (classify + handle)
        const { response, intent } = await processMessage(
          tenantId,
          messageText,
          context
        );

        // Step 5: Send response via Gowa
        const phone = senderJid.replace("@s.whatsapp.net", "");
        await sendWhatsAppMessage(phone, response, tenantId);

        // Step 6: Log anonymized metrics (NO PII content stored)
        const responseTimeMs = Date.now() - startTime;

        await db.insert(waMessageLog).values([
          {
            tenantId,
            direction: "incoming" as const,
            intentType: intent.intent,
            processedAt: new Date(),
            responseTimeMs,
          },
          {
            tenantId,
            direction: "outgoing" as const,
            intentType: intent.intent,
            processedAt: new Date(),
            responseTimeMs,
          },
        ]);

        // Step 7: Update conversation context
        await addMessage(senderJid, "user", messageText);
        await addMessage(senderJid, "assistant", response);

        console.log(
          `[Worker] Processed message ${messageId} in ${responseTimeMs}ms (intent: ${intent.intent})`
        );
      } catch (error) {
        console.error(`[Worker] Error processing message ${messageId}:`, error);

        // Send a fallback error message to the user
        try {
          if (tenantId) {
            const phone = senderJid.replace("@s.whatsapp.net", "");
            await sendWhatsAppMessage(
              phone,
              "Mohon maaf, terjadi gangguan pada sistem kami. Silakan coba lagi dalam beberapa saat. 🙏",
              tenantId
            );
          }
        } catch {
          // Silent fail for error message
        }

        throw error; // Re-throw to trigger BullMQ retry
      }
    },
    {
      connection: redisConnection,
      concurrency: 5, // Process up to 5 messages concurrently
      limiter: {
        max: 20, // Max 20 jobs per minute per NFR-2
        duration: 60000,
      },
    }
  );

  worker.on("completed", (job) => {
    console.log(`[Worker] Job ${job.id} completed`);
  });

  worker.on("failed", (job, err) => {
    console.error(`[Worker] Job ${job?.id} failed:`, err.message);
  });

  worker.on("error", (err) => {
    console.error("[Worker] Worker error:", err);
  });

  console.log("[Worker] WhatsApp message worker started");

  return worker;
}
