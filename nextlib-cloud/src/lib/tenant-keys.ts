import { db } from "./db";
import { tenants } from "./db/schema";
import { eq } from "drizzle-orm";
import { generateEd25519Keypair, encrypt } from "./crypto";

export interface TenantKeypair {
  /** 32 bytes, base64 */
  publicKey: string;
  /** AES-256-GCM encrypted, base64 */
  privateKeyEncrypted: string;
}

/**
 * Get the tenant's Ed25519 keypair, lazily generating one if missing.
 * Idempotent: if both columns are set, returns the existing key.
 */
export async function ensureTenantKeypair(tenantId: string): Promise<TenantKeypair> {
  const encryptionKey = process.env.AES_256_ENCRYPTION_KEY;
  if (!encryptionKey) {
    throw new Error("AES_256_ENCRYPTION_KEY is not configured");
  }

  const [existing] = await db
    .select({
      ed25519PublicKey: tenants.ed25519PublicKey,
      ed25519PrivateKeyEncrypted: tenants.ed25519PrivateKeyEncrypted,
    })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);

  if (existing?.ed25519PublicKey && existing?.ed25519PrivateKeyEncrypted) {
    return {
      publicKey: existing.ed25519PublicKey,
      privateKeyEncrypted: existing.ed25519PrivateKeyEncrypted,
    };
  }

  const kp = generateEd25519Keypair();
  const privateKeyEncrypted = encrypt(kp.privateKey, encryptionKey);
  await db
    .update(tenants)
    .set({
      ed25519PublicKey: kp.publicKey,
      ed25519PrivateKeyEncrypted: privateKeyEncrypted,
      ed25519RotatedAt: new Date(),
      ed25519KeyId: crypto.randomUUID(),
    })
    .where(eq(tenants.id, tenantId));

  return { publicKey: kp.publicKey, privateKeyEncrypted };
}
