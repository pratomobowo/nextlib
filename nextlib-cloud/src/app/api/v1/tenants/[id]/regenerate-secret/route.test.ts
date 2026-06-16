import { describe, it, expect, vi, beforeEach } from "vitest";

const sessionUser = { user: { id: "u1", email: "admin@x.com", role: "tenant_admin", tenantId: "t1" } };
const otherUser = { user: { id: "u2", email: "other@x.com", role: "tenant_admin", tenantId: "t-other" } };
const superUser = { user: { id: "su", email: "su@x.com", role: "super_admin", tenantId: null } };

const rlResult = { allowed: true, remaining: 4, resetSec: 60 };

// ---------------------------------------------------------------------------
// Hoisted shared mock state.
//
// `vi.mock` factories run above imports, so any module-scope state they
// reference must be created via `vi.hoisted` (which also runs in the
// hoisted region). Direct `vi.fn()` declarations after `vi.mock` would
// throw `ReferenceError: Cannot access '<name>' before initialization`.
// ---------------------------------------------------------------------------
const { updateMock, insertMock, getSessionUserMock, rlMock } = vi.hoisted(() => ({
  updateMock: vi.fn(),
  insertMock: vi.fn(),
  getSessionUserMock: vi.fn(),
  rlMock: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  getSessionUser: () => getSessionUserMock(),
}));
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
vi.mock("@/lib/db", () => ({
  db: {
    update: () => ({ set: () => ({ where: () => ({ returning: () => updateMock() }) }) }),
  },
}));
vi.mock("@/lib/db/schema", () => ({
  tenants: { id: "id", apiSecretEncrypted: "apiSecretEncrypted", tokenHash: "tokenHash" },
}));

// Mock crypto.randomBytes / createHash to return predictable values.
vi.mock("crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("crypto")>();
  return {
    ...actual,
    randomBytes: () => ({ toString: () => "newsecrethex64" }),
    createHash: () => ({ update: () => ({ digest: () => "newhash" }) }),
  };
});

vi.mock("@/lib/crypto", () => ({ encrypt: (s: string) => `enc(${s})` }));

import { POST } from "./route";

beforeEach(() => {
  updateMock.mockReset();
  insertMock.mockReset();
  getSessionUserMock.mockReset();
  rlMock.mockReset();
  rlMock.mockResolvedValue(rlResult);
  updateMock.mockResolvedValue([{ id: "t1" }]);
  insertMock.mockResolvedValue(undefined);
});

function makeReq(body: unknown) {
  return new Request("http://test/api/v1/tenants/t1/regenerate-secret", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /regenerate-secret", () => {
  it("401 when no session", async () => {
    getSessionUserMock.mockResolvedValue(null);
    const res = await POST(makeReq({ confirm: true }), { params: Promise.resolve({ id: "t1" }) });
    expect(res.status).toBe(401);
  });

  it("403 when not owner", async () => {
    getSessionUserMock.mockResolvedValue(otherUser);
    const res = await POST(makeReq({ confirm: true }), { params: Promise.resolve({ id: "t1" }) });
    expect(res.status).toBe(403);
  });

  it("200 when super_admin on any tenant", async () => {
    getSessionUserMock.mockResolvedValue(superUser);
    const res = await POST(makeReq({ confirm: true }), { params: Promise.resolve({ id: "t1" }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.api_token).toBe("newsecrethex64");
  });

  it("200 when owner regenerates", async () => {
    getSessionUserMock.mockResolvedValue(sessionUser);
    const res = await POST(makeReq({ confirm: true }), { params: Promise.resolve({ id: "t1" }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.api_token).toBe("newsecrethex64");
  });

  it("400 when confirm is not true", async () => {
    getSessionUserMock.mockResolvedValue(sessionUser);
    const res = await POST(makeReq({ confirm: false }), { params: Promise.resolve({ id: "t1" }) });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("CONFIRMATION_REQUIRED");
  });

  it("429 when rate limited", async () => {
    getSessionUserMock.mockResolvedValue(sessionUser);
    rlMock.mockResolvedValue({ allowed: false, remaining: 0, resetSec: 1800 });
    const res = await POST(makeReq({ confirm: true }), { params: Promise.resolve({ id: "t1" }) });
    expect(res.status).toBe(429);
  });

  it("writes audit log with [REDACTED] values", async () => {
    getSessionUserMock.mockResolvedValue(sessionUser);
    await POST(makeReq({ confirm: true }), { params: Promise.resolve({ id: "t1" }) });
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "regenerate_secret",
        oldValue: "[REDACTED]",
        newValue: "[REDACTED]",
      })
    );
  });
});
