import Redis from "ioredis";

/**
 * Redis connection singleton.
 * Used by BullMQ message queues and conversation context cache.
 * Connects via REDIS_URL env var (default: redis://localhost:6379).
 */

let redis: Redis | null = null;

export function getRedis(): Redis {
  if (!redis) {
    const url = process.env.REDIS_URL || "redis://localhost:6379";
    redis = new Redis(url, {
      maxRetriesPerRequest: null, // Required by BullMQ
      enableReadyCheck: false,
      retryStrategy(times: number) {
        const delay = Math.min(times * 200, 5000);
        return delay;
      },
    });

    redis.on("error", (err) => {
      console.error("[Redis] Connection error:", err.message);
    });

    redis.on("connect", () => {
      console.log("[Redis] Connected successfully");
    });
  }

  return redis;
}

/**
 * Create a new Redis connection (for BullMQ workers that need dedicated connections).
 */
export function createRedisConnection(): Redis {
  const url = process.env.REDIS_URL || "redis://localhost:6379";
  return new Redis(url, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    retryStrategy(times: number) {
      const delay = Math.min(times * 200, 5000);
      return delay;
    },
  });
}

export default getRedis;
