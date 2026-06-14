import { getRedis } from "@/lib/redis";
import type { ConversationMessage } from "./llm-client";

/**
 * Redis-based conversation memory for WhatsApp chats.
 *
 * Stores conversation context per sender JID with:
 * - Maximum 10 messages per conversation
 * - 24-hour TTL (auto-expires per NFR-1: no permanent PII storage)
 * - Key format: wa:ctx:{senderJid}
 *
 * Compliant with UU PDP: conversation data is ephemeral and automatically purged.
 */

const CONTEXT_PREFIX = "wa:ctx:";
const MAX_MESSAGES = 10;
const TTL_SECONDS = 86400; // 24 hours

/**
 * Get conversation context for a sender.
 *
 * @param senderJid - WhatsApp sender JID (e.g., 628xxx@s.whatsapp.net)
 * @returns Array of conversation messages (max 10)
 */
export async function getContext(
  senderJid: string
): Promise<ConversationMessage[]> {
  try {
    const redis = getRedis();
    const key = `${CONTEXT_PREFIX}${senderJid}`;
    const data = await redis.get(key);

    if (!data) return [];

    const messages = JSON.parse(data) as ConversationMessage[];
    return messages.slice(-MAX_MESSAGES);
  } catch (error) {
    console.error("[ConversationContext] Failed to get context:", error);
    return [];
  }
}

/**
 * Add a message to the conversation context.
 * Automatically trims to MAX_MESSAGES and refreshes TTL.
 *
 * @param senderJid - WhatsApp sender JID
 * @param role - Message role ('user' for incoming, 'assistant' for outgoing)
 * @param content - Message text content
 */
export async function addMessage(
  senderJid: string,
  role: "user" | "assistant",
  content: string
): Promise<void> {
  try {
    const redis = getRedis();
    const key = `${CONTEXT_PREFIX}${senderJid}`;

    // Get existing context
    const existing = await getContext(senderJid);

    // Append new message and trim to max
    existing.push({ role, content });
    const trimmed = existing.slice(-MAX_MESSAGES);

    // Save with TTL
    await redis.setex(key, TTL_SECONDS, JSON.stringify(trimmed));
  } catch (error) {
    console.error("[ConversationContext] Failed to add message:", error);
  }
}

/**
 * Clear conversation context for a sender.
 *
 * @param senderJid - WhatsApp sender JID
 */
export async function clearContext(senderJid: string): Promise<void> {
  try {
    const redis = getRedis();
    const key = `${CONTEXT_PREFIX}${senderJid}`;
    await redis.del(key);
  } catch (error) {
    console.error("[ConversationContext] Failed to clear context:", error);
  }
}

/**
 * Get the count of active conversation contexts (for monitoring).
 *
 * @returns Number of active conversation contexts
 */
export async function getActiveContextCount(): Promise<number> {
  try {
    const redis = getRedis();
    const keys = await redis.keys(`${CONTEXT_PREFIX}*`);
    return keys.length;
  } catch (error) {
    console.error("[ConversationContext] Failed to count contexts:", error);
    return 0;
  }
}
