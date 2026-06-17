import { describe, it, expect, vi, beforeEach } from "vitest";

const sessionUser = { user: { id: "u1", email: "admin@x.com", role: "tenant_admin", tenantId: "t1" } };
const otherUser = { user: { id: "u2", email: "x@x.com", role: "tenant_admin", tenantId: "t-other" } };

const getSessionUserMock = vi.fn();
const rlMock = vi.fn();
const updateMock = vi.fn();
const insertMock = vi.fn();
const tenantResult = vi.fn();

vi.mock("@/lib/auth/session", () => ({ getSessionUser: () => getSessionUserMock() }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: (...a: unknown[]) => rlMock(...a) }));
vi.mock("@/lib/tenant-audit", () => ({ writeAuditLog: (...a: unknown[]) => insertMock(...a) }));
vi.mock("@/lib/tenant-access-guard", () => ({
  checkTenantAccess: (user: { role: string; tenantId: string | null } | null, tenantId: string) => {
    if (!user) return { allowed: false, status: 401, code: "UNAUTHORIZED", message: "Authentication required" };
    if (user.role === "super_admin") return { allowed: true };
    if (user.tenantId === tenantId) return { allowed: true };
    return { allowed: false, status: 403, code: "FORBIDDEN", message: "You do not have access to this tenant." };
  },
}));
vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          // Drizzle's .limit(1) returns an array; the route does const [tenant] = ...
          limit: () => {
            const r = tenantResult();
            return r ? [r] : [];
          },
        }),
      }),
    }),
    update: () => ({
      set: () => ({
        where: () => {
          // The route does db.update().set().where() (no .returning() call),
          // so we invoke updateMock on where() to simulate the UPDATE executing.
          updateMock();
          return Promise.resolve();
        },
      }),
    }),
  },
}));
vi.mock("@/lib/db/schema", () => ({
  tenants: { id: "id", slug: "slug", name: "name" },
}));
vi.mock("@/lib/crypto", () => ({ encrypt: (s: string) => `enc(${s})` }));
vi.mock("@/lib/tenant-keys", () => ({
  ensureTenantKeypair: () =>
    Promise.resolve({ publicKey: "MOCK_PUB_KEY_BASE64", privateKeyEncrypted: "MOCK_ENC" }),
}));
// Allow existsSync to return true for the first candidate the route checks
// (process.cwd() + '/nextlib-agent' and its sibling plugin.php file)
vi.mock("fs", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    existsSync: vi.fn((p: string) => {
      const norm = p.replace(/\/+$/, "");
      return (
        norm.endsWith("nextlib-agent") ||
        norm.endsWith("nextlib-agent.plugin.php")
      );
    }),
    statSync: () => ({ isDirectory: () => true }),
    createReadStream: () => ({ pipe: () => {}, on: () => {} }),
  };
});
// Mock archiver to return a stub stream that emits a tiny ZIP-like buffer
vi.mock("archiver", () => {
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
  const appendCalls: Array<{ content: string; name?: string }> = [];
  return {
    ZipArchive: class {
      on(e: string, cb: (...args: unknown[]) => void) {
        if (!listeners.has(e)) listeners.set(e, []);
        listeners.get(e)!.push(cb);
        return this;
      }
      append(content: string, opts: { name?: string }) {
        appendCalls.push({ content, name: opts.name });
        return this;
      }
      directory(_path: string, _name: string) {
        return this;
      }
      finalize() {
        // Emit "end" so the ReadableStream closes and the response completes
        setTimeout(() => {
          (listeners.get("end") || []).forEach((cb) => cb());
        }, 0);
        return this;
      }
    },
    __getAppendCalls: () => appendCalls,
  };
});

import { GET } from "./route";

beforeEach(() => {
  getSessionUserMock.mockReset();
  rlMock.mockReset();
  updateMock.mockReset();
  insertMock.mockReset();
  tenantResult.mockReset();

  // The route encrypts the new token with this env var
  process.env.AES_256_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

  rlMock.mockReturnValue({ allowed: true, remaining: 4, resetSec: 60 });
  updateMock.mockReturnValue([{ id: "t1" }]);
  insertMock.mockReturnValue(undefined);
  tenantResult.mockReturnValue({
    id: "t1",
    slug: "universitas-nextlib",
    name: "Universitas NextLib",
  });
  getSessionUserMock.mockResolvedValue(sessionUser);
});

function makeReq() {
  return new Request("http://test/api/v1/tenants/t1/agent-zip", { method: "GET" });
}

describe("GET /agent-zip", () => {
  it("401 when no session", async () => {
    getSessionUserMock.mockResolvedValue(null);
    const res = await GET(makeReq(), { params: Promise.resolve({ id: "t1" }) });
    expect(res.status).toBe(401);
  });

  it("403 when not owner", async () => {
    getSessionUserMock.mockResolvedValue(otherUser);
    const res = await GET(makeReq(), { params: Promise.resolve({ id: "t1" }) });
    expect(res.status).toBe(403);
  });

  it("429 when rate limited", async () => {
    rlMock.mockReturnValue({ allowed: false, remaining: 0, resetSec: 1800 });
    const res = await GET(makeReq(), { params: Promise.resolve({ id: "t1" }) });
    expect(res.status).toBe(429);
  });

  it("404 when tenant not found", async () => {
    tenantResult.mockReturnValue(null);
    const res = await GET(makeReq(), { params: Promise.resolve({ id: "t1" }) });
    expect(res.status).toBe(404);
  });

  it("regenerates token + writes audit log before streaming", async () => {
    const res = await GET(makeReq(), { params: Promise.resolve({ id: "t1" }) });
    expect(res.status).toBe(200);
    expect(updateMock).toHaveBeenCalled();
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "regenerate_secret",
        oldValue: "[REDACTED]",
        newValue: "[REDACTED]",
        metadata: expect.objectContaining({ reason: "agent-zip-download" }),
      })
    );
    expect(res.headers.get("content-type")).toBe("application/zip");
  });

  it("includes NEXTLIB_PUBLIC_KEY in the streamed .env (Ed25519 v2 auth)", async () => {
    const { __getAppendCalls } = (await import("archiver")) as unknown as {
      __getAppendCalls: () => Array<{ content: string; name?: string }>;
    };
    const res = await GET(makeReq(), { params: Promise.resolve({ id: "t1" }) });
    expect(res.status).toBe(200);
    const envCall = __getAppendCalls().find((c) => c.name === "nextlib-agent/.env");
    expect(envCall, ".env should be appended to the ZIP").toBeDefined();
    expect(envCall!.content).toContain("NEXTLIB_PUBLIC_KEY=MOCK_PUB_KEY_BASE64");
    // Legacy HMAC env is still present for backward compat (deprecated in v2).
    // .env ships the raw secret (randomBytes(32).toString('hex') = 64 hex chars).
    expect(envCall!.content).toMatch(/NEXTLIB_TOKEN_SECRET=[0-9a-f]{64}/);
  });
});
