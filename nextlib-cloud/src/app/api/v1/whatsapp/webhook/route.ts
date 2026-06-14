import { NextRequest, NextResponse } from "next/server";
import { createHmac } from "crypto";
import {
  waIncomingQueue,
  type IncomingMessageJob,
} from "@/lib/whatsapp/message-queue";
import { db } from "@/lib/db";
import { whatsappSessions } from "@/lib/db/schema";
import { eq, or } from "drizzle-orm";

/**
 * POST /api/v1/whatsapp/webhook
 *
 * Receives webhook events from the Gowa WhatsApp engine.
 * Validates HMAC-SHA256 signature, then enqueues messages for async processing.
 *
 * Event types handled:
 * - message: Incoming WA message → enqueue for LLM processing
 * - connected: Device connected → update session status
 * - disconnected: Device disconnected → update session status
 *
 * Returns 200 OK immediately for all valid requests (async processing via BullMQ).
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.text();

    // Validate webhook signature if secret is configured
    const webhookSecret = process.env.WHATSAPP_WEBHOOK_SECRET;
    if (webhookSecret) {
      const signature = request.headers.get("x-webhook-signature") || "";
      const expectedSignature = createHmac("sha256", webhookSecret)
        .update(body)
        .digest("hex");

      if (signature !== expectedSignature) {
        console.warn("[Webhook] Invalid signature, rejecting request");
        return NextResponse.json(
          { success: false, error: "Invalid signature" },
          { status: 401 }
        );
      }
    }

    const payload = JSON.parse(body);
    const { event, device_id: deviceId } = payload;

    console.log(`[Webhook] Received event: ${event} from device: ${deviceId}`);

    switch (event) {
      case "message": {
        await handleIncomingMessage(payload);
        break;
      }

      case "connected": {
        await handleDeviceConnected(deviceId, payload);
        break;
      }

      case "disconnected": {
        await handleDeviceDisconnected(deviceId);
        break;
      }

      default: {
        console.log(`[Webhook] Unhandled event type: ${event}`);
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[Webhook] Error processing webhook:", error);
    // Still return 200 to avoid Gowa retrying
    return NextResponse.json({ success: true });
  }
}

/**
 * Enqueue incoming message for async LLM processing via BullMQ.
 */
async function handleIncomingMessage(payload: any) {
  const messageData = payload.payload || {};
  const senderJid = messageData.from || messageData.jid || "";
  const messageText =
    messageData.text ||
    messageData.message?.conversation ||
    messageData.message?.extendedTextMessage?.text ||
    "";
  const isGroup = senderJid.includes("@g.us");

  // Skip group messages and empty messages
  if (isGroup || !messageText.trim()) {
    console.log(
      `[Webhook] Skipping ${isGroup ? "group" : "empty"} message from ${senderJid}`
    );
    return;
  }

  const job: IncomingMessageJob = {
    event: "message",
    deviceId: payload.device_id || "",
    senderJid,
    messageText: messageText.trim(),
    messageId: messageData.id || `msg_${Date.now()}`,
    receivedAt: new Date().toISOString(),
    isGroup: false,
  };

  await waIncomingQueue.add(`msg:${job.messageId}`, job, {
    // Dedup: skip if same message ID already queued
    jobId: job.messageId,
  });

  console.log(
    `[Webhook] Enqueued message from ${senderJid}: "${messageText.substring(0, 50)}..."`
  );
}

/**
 * Update session status when a device connects successfully.
 */
async function handleDeviceConnected(deviceId: string, payload: any) {
  const phoneNumber =
    payload.payload?.phone_number || deviceId?.split("@")[0] || "";

  console.log(`[Webhook] Device connected: ${deviceId} (${phoneNumber})`);

  // Find session (match custom tenantId/deviceId or physical JID)
  const sessions = await db
    .select()
    .from(whatsappSessions)
    .where(
      or(
        eq(whatsappSessions.tenantId, deviceId),
        eq(whatsappSessions.deviceId, deviceId)
      )
    );

  if (sessions.length > 0) {
    const session = sessions[0];
    const physicalJid = payload.payload?.jid || (deviceId.includes("@") ? deviceId : "");

    await db
      .update(whatsappSessions)
      .set({
        status: "connected",
        phoneNumber: phoneNumber || session.phoneNumber,
        deviceId: physicalJid || session.deviceId || deviceId, // Store physical JID
        connectedAt: new Date(),
        disconnectedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(whatsappSessions.id, session.id));
  }
}

/**
 * Update session status when a device disconnects.
 */
async function handleDeviceDisconnected(deviceId: string) {
  console.log(`[Webhook] Device disconnected: ${deviceId}`);

  const sessions = await db
    .select()
    .from(whatsappSessions)
    .where(
      or(
        eq(whatsappSessions.tenantId, deviceId),
        eq(whatsappSessions.deviceId, deviceId)
      )
    );

  if (sessions.length > 0) {
    await db
      .update(whatsappSessions)
      .set({
        status: "disconnected",
        disconnectedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(whatsappSessions.id, sessions[0].id));
  }
}
