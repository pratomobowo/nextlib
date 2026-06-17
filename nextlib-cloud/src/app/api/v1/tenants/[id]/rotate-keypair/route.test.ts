import { describe, it, expect, vi, beforeEach } from "vitest";

const sessionUser = { user: { id: "u1", email: "a@x", role: "tenant_admin", tenantId: "t1" } };
const otherUser = { user: { id: "u2", email: "x@x", role: "tenant_admin", tenantId: "t-other" } };

const {
  getSessionUserMock,
  rlMock,
  updateMock,
  insertMock,
  generateEd25519KeypairMock,
  encryptMock,
} = vi.hoisted(() => ({
  getSessionUserMock: vi.fn(),
  rlMock: vi.fn(),
  updateMock: vi.fn(),
  insertMock: vi.fn(),
  generateEd25519KeypairMock: vi.fn(),
  encryptMock: vi.fn(),
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
  generateEd25519Keypair: (...a: unknown[]) => generateEd25519KeypairMock(...a),
  encrypt: (...a: unknown[]) => encryptMock(...a),
}));
vi.mock("@/lib/db", () => ({
  db: {
    update: () => ({ set: () => ({ where: () => { updateMock(); return Promise.resolve(); } }) }),
  },
}));
vi.mock("@/lib/db/schema", () => ({
  tenants: { id: "id" },
}));

import { POST } from "./route";

beforeEach(() => {
  getSessionUserMock.mockReset();
  rlMock.mockReset();
  updateMock.mockReset();
  insertMock.mockReset();
  generateEd25519KeypairMock.mockReset();
  encryptMock.mockReset();

  process.env.AES_256_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  rlMock.mockResolvedValue({ allowed: true, remaining: 2, resetSec: 3600 });
  updateMock.mockResolvedValue([{ id: "t1" }]);
  insertMock.mockResolvedValue(undefined);
  generateEd25519KeypairMock.mockReturnValue({ publicKey: "NEW_PUB_BASE64", privateKey: "NEW_PRIV_BASE64" });
  encryptMock.mockReturnValue("encrypted-private-key");
  getSessionUserMock.mockResolvedValue(sessionUser);
});

function makeReq() {
  return new Request("http://test/api/v1/tenants/t1/rotate-keypair", { method: "POST" });
}

describe("POST /rotate-keypair", () => {
  it("401 when no session", async () => {
    getSessionUserMock.mockResolvedValue(null);
    const res = await POST(makeReq(), { params: Promise.resolve({ id: "t1" }) });
    expect(res.status).toBe(401);
  });

  it("403 when not owner", async () => {
    getSessionUserMock.mockResolvedValue(otherUser);
    const res = await POST(makeReq(), { params: Promise.resolve({ id: "t1" }) });
    expect(res.status).toBe(403);
  });

  it("429 when rate limited", async () => {
    rlMock.mockResolvedValue({ allowed: false, remaining: 0, resetSec: 1800 });
    const res = await POST(makeReq(), { params: Promise.resolve({ id: "t1" }) });
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("1800");
  });

  it("500 when AES_256_ENCRYPTION_KEY is missing", async () => {
    delete process.env.AES_256_ENCRYPTION_KEY;
    const res = await POST(makeReq(), { params: Promise.resolve({ id: "t1" }) });
    expect(res.status).toBe(500);
  });

  it("200 + new publicKey + DB update + audit log on success", async () => {
    const res = await POST(makeReq(), { params: Promise.resolve({ id: "t1" }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.publicKey).toBe("NEW_PUB_BASE64");
    expect(body.data.rotatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(generateEd25519KeypairMock).toHaveBeenCalledOnce();
    expect(encryptMock).toHaveBeenCalledWith("NEW_PRIV_BASE64", expect.any(String));
    expect(updateMock).toHaveBeenCalledOnce();
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "regenerate_secret",
        metadata: expect.objectContaining({ reason: "ed25519-keypair-rotation" }),
      })
    );
  });
});
