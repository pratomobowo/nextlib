import { describe, it, expect, vi, beforeEach } from "vitest";

const sessionUser = { user: { id: "u1", email: "a@x", role: "tenant_admin", tenantId: "t1" } };
const otherUser = { user: { id: "u2", email: "x@x", role: "tenant_admin", tenantId: "t-other" } };

// ---------------------------------------------------------------------------
// Hoisted shared mock state. `vi.mock` factories run before imports, so any
// module-scope state they reference must be created via `vi.hoisted`.
// ---------------------------------------------------------------------------
const {
  getSessionUserMock,
  rlMock,
  updateMock,
  insertMock,
  fetchMock,
  decryptMock,
  generateTokenMock,
  createHashMock,
} = vi.hoisted(() => ({
  getSessionUserMock: vi.fn(),
  rlMock: vi.fn(),
  updateMock: vi.fn(),
  insertMock: vi.fn(),
  fetchMock: vi.fn(),
  decryptMock: vi.fn(),
  generateTokenMock: vi.fn(),
  createHashMock: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({ getSessionUser: () => getSessionUserMock() }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: (...a: unknown[]) => rlMock(...a) }));
vi.mock("@/lib/tenant-audit", () => ({ writeAuditLog: (...a: unknown[]) => insertMock(...a) }));
vi.mock("@/lib/tenant-access-guard", () => ({
  checkTenantAccess: (user: { role: string; tenantId: string | null }, tenantId: string) => {
    if (!user) return { allowed: false, status: 401, code: "UNAUTHORIZED", message: "Authentication required" };
    if (user.role === "super_admin") return { allowed: true };
    if (user.tenantId === tenantId) return { allowed: true };
    return { allowed: false, status: 403, code: "FORBIDDEN", message: "You do not have access to this tenant." };
  },
}));
vi.mock("@/lib/crypto", () => ({ decrypt: (...a: unknown[]) => decryptMock(...a) }));
vi.mock("@/lib/hmac", () => ({ generateToken: (...a: unknown[]) => generateTokenMock(...a) }));
vi.mock("crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("crypto")>();
  return { ...actual, createHash: (...a: unknown[]) => createHashMock(...a) };
});
vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => [{ id: "t1", slimsBaseUrl: "enc-url", apiSecretEncrypted: "enc-secret", status: "pending" }],
        }),
      }),
    }),
    update: () => ({ set: () => ({ where: () => ({ returning: () => updateMock() }) }) }),
  },
}));
vi.mock("@/lib/db/schema", () => ({
  tenants: { id: "id", slimsBaseUrl: "slimsBaseUrl", apiSecretEncrypted: "apiSecretEncrypted", status: "status" },
}));

global.fetch = fetchMock;

import { POST } from "./route";

beforeEach(() => {
  fetchMock.mockReset();
  updateMock.mockReset();
  insertMock.mockReset();
  getSessionUserMock.mockReset();
  rlMock.mockReset();
  decryptMock.mockReset();
  generateTokenMock.mockReset();
  createHashMock.mockReset();
  rlMock.mockResolvedValue({ allowed: true, remaining: 9, resetSec: 60 });
  updateMock.mockResolvedValue([{ id: "t1" }]);
  insertMock.mockResolvedValue(undefined);
  getSessionUserMock.mockResolvedValue(sessionUser);
  decryptMock.mockReturnValue("https://slims.test/");
  generateTokenMock.mockReturnValue("t.tok");
  createHashMock.mockReturnValue({ update: () => ({ digest: () => "h(secret)" }) });
});

function makeReq() {
  return new Request("http://test/api/v1/tenants/t1/test-connection", { method: "POST" });
}

describe("POST /test-connection", () => {
  it("agent 200 → status=connected, audit log success", async () => {
    fetchMock.mockResolvedValue({
      status: 200,
      ok: true,
      text: () =>
        Promise.resolve(JSON.stringify({ status: "healthy", database: { connected: true } })),
    });
    const res = await POST(makeReq(), { params: Promise.resolve({ id: "t1" }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.success).toBe(true);
    expect(body.data.status).toBe("connected");
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "test_connection",
        metadata: expect.objectContaining({ success: true }),
      })
    );
  });

  it("agent 500 → status=disconnected, audit log failure", async () => {
    fetchMock.mockResolvedValue({
      status: 500,
      ok: false,
      text: () => Promise.resolve("Internal Server Error"),
    });
    const res = await POST(makeReq(), { params: Promise.resolve({ id: "t1" }) });
    const body = await res.json();
    expect(body.data.status).toBe("disconnected");
    expect(body.data.category).toBe("server_error");
  });

  it("network error → status=disconnected", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));
    const res = await POST(makeReq(), { params: Promise.resolve({ id: "t1" }) });
    const body = await res.json();
    expect(body.data.status).toBe("disconnected");
  });

  it("403 when not owner", async () => {
    getSessionUserMock.mockResolvedValue(otherUser);
    const res = await POST(makeReq(), { params: Promise.resolve({ id: "t1" }) });
    expect(res.status).toBe(403);
  });

  it("429 when rate limited", async () => {
    rlMock.mockResolvedValue({ allowed: false, remaining: 0, resetSec: 60 });
    const res = await POST(makeReq(), { params: Promise.resolve({ id: "t1" }) });
    expect(res.status).toBe(429);
  });
});
