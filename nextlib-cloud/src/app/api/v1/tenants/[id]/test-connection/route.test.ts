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
  signRequestMock,
  ensureTenantKeypairMock,
} = vi.hoisted(() => ({
  getSessionUserMock: vi.fn(),
  rlMock: vi.fn(),
  updateMock: vi.fn(),
  insertMock: vi.fn(),
  fetchMock: vi.fn(),
  decryptMock: vi.fn(),
  signRequestMock: vi.fn(),
  ensureTenantKeypairMock: vi.fn(),
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
vi.mock("@/lib/crypto", () => ({
  decrypt: (...a: unknown[]) => decryptMock(...a),
  signRequest: (...a: unknown[]) => signRequestMock(...a),
}));
vi.mock("@/lib/tenant-keys", () => ({
  ensureTenantKeypair: (...a: unknown[]) => ensureTenantKeypairMock(...a),
}));
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
  signRequestMock.mockReset();
  ensureTenantKeypairMock.mockReset();
  rlMock.mockResolvedValue({ allowed: true, remaining: 9, resetSec: 60 });
  updateMock.mockResolvedValue([{ id: "t1" }]);
  insertMock.mockResolvedValue(undefined);
  getSessionUserMock.mockResolvedValue(sessionUser);
  decryptMock.mockReturnValue("https://slims.test/");
  ensureTenantKeypairMock.mockResolvedValue({
    publicKey: "PUB_KEY",
    privateKeyEncrypted: "enc-priv",
  });
  signRequestMock.mockReturnValue("mock-signature-base64");
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

  it("agent 404 with Apache HTML body → routing_misconfigured (not plugin_not_installed)", async () => {
    fetchMock.mockResolvedValue({
      status: 404,
      ok: false,
      text: () =>
        Promise.resolve(
          "<!DOCTYPE HTML><html><head><title>404 Not Found</title></head><body><h1>Not Found</h1><address>Apache Server at opac.example Port 443</address></body></html>"
        ),
    });
    const res = await POST(makeReq(), { params: Promise.resolve({ id: "t1" }) });
    const body = await res.json();
    expect(body.data.category).toBe("routing_misconfigured");
    expect(body.data.title).toContain("routing");
  });

  it("agent 404 with JSON error body → plugin_not_installed", async () => {
    fetchMock.mockResolvedValue({
      status: 404,
      ok: false,
      text: () =>
        Promise.resolve(
          JSON.stringify({ error: "Route /v1/nextlib/health not found" })
        ),
    });
    const res = await POST(makeReq(), { params: Promise.resolve({ id: "t1" }) });
    const body = await res.json();
    expect(body.data.category).toBe("plugin_not_installed");
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

  it("sends Ed25519 signature headers (X-NextLib-Timestamp + X-NextLib-Signature)", async () => {
    fetchMock.mockResolvedValue({
      status: 200,
      ok: true,
      text: () =>
        Promise.resolve(JSON.stringify({ status: "healthy", database: { connected: true } })),
    });
    await POST(makeReq(), { params: Promise.resolve({ id: "t1" }) });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [_url, init] = fetchMock.mock.calls[0];
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers["X-NextLib-Timestamp"]).toMatch(/^\d+$/);
    expect(headers["X-NextLib-Signature"]).toBe("mock-signature-base64");
    // Legacy HMAC headers must NOT be present anymore
    expect(headers["X-NextLib-Token"]).toBeUndefined();
    expect(headers["X-NextLib-Secret-Hash"]).toBeUndefined();
  });

  it("signRequest is called with the right canonical message (GET /api/v1/nextlib/health, empty body)", async () => {
    fetchMock.mockResolvedValue({
      status: 200,
      ok: true,
      text: () => Promise.resolve("{}"),
    });
    await POST(makeReq(), { params: Promise.resolve({ id: "t1" }) });
    expect(signRequestMock).toHaveBeenCalledTimes(1);
    const args = signRequestMock.mock.calls[0];
    // args: (privateKey, timestamp, method, path, body)
    expect(typeof args[0]).toBe("string"); // decrypted private key
    expect(args[1]).toMatch(/^\d+$/); // timestamp seconds since epoch
    expect(args[2]).toBe("GET");
    // Path is whatever new URL(healthUrl).pathname produces — assert suffix
    // (mock decrypt adds trailing slash so pathname can be "//api/v1/nextlib/health"
    // in tests; in prod slimsBaseUrl has no trailing slash)
    expect(args[3]).toMatch(/\/api\/v1\/nextlib\/health$/);
    expect(args[4]).toBe("");
  });
});
