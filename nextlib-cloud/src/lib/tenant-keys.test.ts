import { describe, it, expect, vi, beforeEach } from "vitest";
import { ensureTenantKeypair } from "./tenant-keys";

// vi.mock factories are hoisted above imports, so any value they reference
// must be defined via vi.hoisted (also hoisted) — module-level `const`s are not.
const { dbMock, generateEd25519KeypairMock, encryptMock } = vi.hoisted(() => {
  const dbMock = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn(),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
  };
  const generateEd25519KeypairMock = vi.fn().mockReturnValue({ publicKey: "PUB", privateKey: "PRIV" });
  const encryptMock = vi.fn().mockReturnValue("ENCRYPTED");
  return { dbMock, generateEd25519KeypairMock, encryptMock };
});

vi.mock("@/lib/db", () => ({ db: dbMock }));
vi.mock("@/lib/crypto", () => ({
  generateEd25519Keypair: generateEd25519KeypairMock,
  encrypt: encryptMock,
}));

describe("ensureTenantKeypair", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.AES_256_ENCRYPTION_KEY = "a".repeat(64);
    dbMock.select.mockReturnThis();
    dbMock.from.mockReturnThis();
    dbMock.where.mockReturnThis();
    dbMock.update.mockReturnThis();
    dbMock.set.mockReturnThis();
  });

  it("returns existing keypair if both columns are set", async () => {
    dbMock.limit.mockReturnValueOnce([{ ed25519PublicKey: "EXISTING_PUB", ed25519PrivateKeyEncrypted: "EXISTING_ENC" }]);
    const kp = await ensureTenantKeypair("t1");
    expect(kp).toEqual({ publicKey: "EXISTING_PUB", privateKeyEncrypted: "EXISTING_ENC" });
    expect(generateEd25519KeypairMock).not.toHaveBeenCalled();
  });

  it("generates a new keypair if either column is empty", async () => {
    dbMock.limit.mockReturnValueOnce([{ ed25519PublicKey: null, ed25519PrivateKeyEncrypted: null }]);
    dbMock.update.mockReturnValueOnce({ set: dbMock.set });
    dbMock.set.mockReturnValueOnce({ where: vi.fn().mockReturnValue(undefined) });
    const kp = await ensureTenantKeypair("t1");
    expect(kp).toEqual({ publicKey: "PUB", privateKeyEncrypted: "ENCRYPTED" });
    expect(generateEd25519KeypairMock).toHaveBeenCalledOnce();
    expect(encryptMock).toHaveBeenCalledWith("PRIV", expect.any(String));
  });
});
