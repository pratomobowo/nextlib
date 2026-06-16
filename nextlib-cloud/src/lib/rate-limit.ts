import { getRedis } from "./redis";

export type RateLimitConfig = {
  name: string;
  limit: number;
  windowSec: number;
};

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  resetSec: number;
};

export async function checkRateLimit(
  userId: string,
  cfg: RateLimitConfig
): Promise<RateLimitResult> {
  const redis = getRedis();
  const key = `ratelimit:${cfg.name}:${userId}`;

  const pipeline = redis.multi();
  pipeline.incr(key);
  pipeline.expire(key, cfg.windowSec, "NX");
  const result = (await pipeline.exec()) as
    | [[Error | null, number], [Error | null, number]]
    | null;
  const count = result?.[0]?.[1] ?? 0;
  const ttl = await redis.ttl(key);

  const allowed = count <= cfg.limit;
  return {
    allowed,
    remaining: Math.max(0, cfg.limit - count),
    resetSec: ttl > 0 ? ttl : cfg.windowSec,
  };
}
