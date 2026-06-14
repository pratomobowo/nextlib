import { Queue, type ConnectionOptions } from "bullmq";

/**
 * BullMQ queues for WhatsApp message processing.
 * Uses Redis as the backend for reliable async message handling.
 *
 * NFR-2: Rate limiting via BullMQ to avoid request pileup during peak hours.
 */

/**
 * BullMQ queue names.
 *
 * IMPORTANT: BullMQ v5+ forbids `:` in queue names (it is reserved for the
 * Redis key-prefix separator). Use hyphenated names instead. These constants
 * are shared by the queue (producer) and the worker (consumer) so the two
 * sides can never drift.
 */
export const WA_INCOMING_QUEUE = "wa-incoming";
export const WA_OUTGOING_QUEUE = "wa-outgoing";

const connection: ConnectionOptions = {
  host: new URL(process.env.REDIS_URL || "redis://localhost:6379").hostname,
  port: parseInt(
    new URL(process.env.REDIS_URL || "redis://localhost:6379").port || "6379"
  ),
};

/**
 * Queue for incoming WhatsApp messages from webhook.
 * Messages are enqueued here and processed by the message worker.
 */
export const waIncomingQueue = new Queue(WA_INCOMING_QUEUE, {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 2000,
    },
    removeOnComplete: {
      count: 1000, // Keep last 1000 completed jobs for debugging
      age: 86400, // Remove after 24h
    },
    removeOnFail: {
      count: 500,
      age: 172800, // Keep failed jobs for 48h
    },
  },
});

/**
 * Queue for outgoing WhatsApp responses.
 * Rate-limited to avoid WhatsApp API throttling.
 */
export const waOutgoingQueue = new Queue(WA_OUTGOING_QUEUE, {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 3000,
    },
    removeOnComplete: {
      count: 1000,
      age: 86400,
    },
    removeOnFail: {
      count: 500,
      age: 172800, // Keep failed jobs for 48h
    },
  },
});

/**
 * Job data types for type-safe queue operations.
 */
export interface IncomingMessageJob {
  /** Gowa webhook event type */
  event: string;
  /** Device JID that received the message */
  deviceId: string;
  /** Sender JID (e.g., 628xxx@s.whatsapp.net) */
  senderJid: string;
  /** Message text content */
  messageText: string;
  /** Message ID from WhatsApp */
  messageId: string;
  /** Timestamp when message was received */
  receivedAt: string;
  /** Whether the message is from a group */
  isGroup: boolean;
}

export interface OutgoingMessageJob {
  /** Recipient JID */
  recipientJid: string;
  /** Message text to send */
  messageText: string;
  /** Tenant ID for tracking */
  tenantId: string;
  /** Intent type for logging */
  intentType: string;
  /** Processing start time for response time calculation */
  processingStartedAt: string;
}

export { connection as redisConnection };
