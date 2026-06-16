import { describe, it, expect, beforeEach, vi } from "vitest";

const redisStore = new Map<string, { count: number; resetAt: number }>();

vi.mock("@/lib/redis", () => {
  const ttl = (key: string) => {
    const cur = redisStore.get(key);
    if (!cur) return Promise.resolve(-2);
    return Promise.resolve(
      Math.max(0, Math.ceil((cur.resetAt - Date.now()) / 1000))
    );
  };
  return {
    getRedis: () => ({
      ttl,
      multi: () => {
        const execResults: [Error | null, unknown][] = [];
        const chain: Record<string, unknown> = {
          incr(key: string) {
            const cur = redisStore.get(key) ?? { count: 0, resetAt: 0 };
            cur.count++;
            redisStore.set(key, cur);
            execResults.push([null, cur.count]);
            return chain;
          },
          expire(key: string, sec: number, _flag?: string) {
            const cur = redisStore.get(key);
            if (cur) cur.resetAt = Date.now() + sec * 1000;
            execResults.push([null, 1]);
            return chain;
          },
          async exec() {
            return execResults;
          },
        };
        return chain;
      },
    }),
  };
});

import { checkRateLimit } from "./rate-limit";

describe("checkRateLimit", () => {
  beforeEach(() => redisStore.clear());

  it("allows first N requests within window", async () => {
    for (let i = 0; i < 5; i++) {
      const r = await checkRateLimit("user-1", {
        name: "test",
        limit: 5,
        windowSec: 60,
      });
      expect(r.allowed).toBe(true);
      expect(r.remaining).toBe(5 - i - 1);
    }
  });

  it("denies request N+1 and reports resetSec", async () => {
    for (let i = 0; i < 3; i++) {
      await checkRateLimit("user-2", { name: "test", limit: 3, windowSec: 60 });
    }
    const r = await checkRateLimit("user-2", {
      name: "test",
      limit: 3,
      windowSec: 60,
    });
    expect(r.allowed).toBe(false);
    expect(r.remaining).toBe(0);
    expect(r.resetSec).toBeGreaterThan(0);
  });

  it("uses per-user buckets independently", async () => {
    for (let i = 0; i < 3; i++) {
      await checkRateLimit("user-a", {
        name: "test",
        limit: 3,
        windowSec: 60,
      });
    }
    const r = await checkRateLimit("user-b", {
      name: "test",
      limit: 3,
      windowSec: 60,
    });
    expect(r.allowed).toBe(true);
  });
});
