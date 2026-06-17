/**
 * Seed script for default tenant and dev users.
 *
 * Mirrors the dev-only /api/v1/auth/seed HTTP route, but runs as a CLI
 * so you don't have to expose the HTTP endpoint in production.
 *
 * Usage (local dev):
 *   npm run db:seed
 *
 * Usage (production via docker exec):
 *   docker exec -it <app_container> npm run db:seed
 *
 * Idempotent: re-running won't duplicate rows. Existing tenant or users
 * are detected and the script exits early with a notice.
 */

import { db } from "../src/lib/db";
import { tenants, users } from "../src/lib/db/schema";
import { hashPassword } from "../src/lib/auth/password";
import { encrypt, generateEd25519Keypair } from "../src/lib/crypto";
import { eq } from "drizzle-orm";
import { createHash, randomUUID } from "crypto";

const DEFAULT_TENANT_SLUG = "universitas-nextlib";
const DEFAULT_TENANT_NAME = "Universitas NextLib";
const DEFAULT_SLIMS_URL = "http://localhost:8080";
const DEFAULT_AGENT_API_SECRET = "default_slims_api_secret_key_123456";

const DEFAULT_USERS = [
  { email: "admin@nextlib.cloud",     name: "SaaS Super Admin",    password: "admin",     role: "super_admin"  as const },
  { email: "library@nextlib.cloud",   name: "Library Admin",       password: "library",   role: "tenant_admin" as const },
  { email: "librarian@nextlib.cloud", name: "Assistant Librarian", password: "librarian", role: "librarian"    as const },
];

async function main() {
  const encryptionKey = process.env.AES_256_ENCRYPTION_KEY;
  if (!encryptionKey) {
    console.error("❌ AES_256_ENCRYPTION_KEY is not set in the environment.");
    process.exit(1);
  }

  // 1. Find or create the default tenant
  let tenant = (
    await db.select().from(tenants).where(eq(tenants.slug, DEFAULT_TENANT_SLUG)).limit(1)
  )[0];

  if (!tenant) {
    const apiSecret = DEFAULT_AGENT_API_SECRET;
    const tokenHash = createHash("sha256").update(apiSecret).digest("hex");
    const slimsBaseUrl = DEFAULT_SLIMS_URL;
    const kp = generateEd25519Keypair();
    const ed25519PrivateKeyEncrypted = encrypt(kp.privateKey, encryptionKey);

    [tenant] = await db
      .insert(tenants)
      .values({
        slug: DEFAULT_TENANT_SLUG,
        name: DEFAULT_TENANT_NAME,
        status: "connected",
        slimsBaseUrl: encrypt(slimsBaseUrl, encryptionKey),
        apiSecretEncrypted: encrypt(apiSecret, encryptionKey),
        tokenHash,
        ed25519PublicKey: kp.publicKey,
        ed25519PrivateKeyEncrypted,
        ed25519RotatedAt: new Date(),
        ed25519KeyId: randomUUID(),
      })
      .returning();

    console.log(`✅ Created tenant: ${tenant.name} (${tenant.id})`);
  } else {
    console.log(`ℹ️  Tenant already exists: ${tenant.name} (${tenant.id})`);
  }

  // 2. Idempotent user insert
  const existingUsers = await db.select({ email: users.email }).from(users);
  const existingEmails = new Set(existingUsers.map((u) => u.email));

  let created = 0;
  let skipped = 0;

  for (const u of DEFAULT_USERS) {
    if (existingEmails.has(u.email)) {
      skipped++;
      continue;
    }

    await db.insert(users).values({
      email: u.email,
      name: u.name,
      passwordHash: hashPassword(u.password),
      role: u.role,
      tenantId: u.role === "super_admin" ? null : tenant.id,
    });
    created++;
  }

  console.log(`\n🎉 Seed complete:`);
  console.log(`   Users created: ${created}`);
  console.log(`   Users skipped (already exist): ${skipped}`);

  if (created > 0) {
    console.log(`\n🔑 Default credentials:`);
    for (const u of DEFAULT_USERS) {
      console.log(`   ${u.role.padEnd(13)} → ${u.email}  /  ${u.password}`);
    }
    console.log(`\n⚠️  Change these passwords in production!`);
  }

  console.log(`\n🔌 Agent API secret for the seeded tenant:`);
  console.log(`   ${DEFAULT_AGENT_API_SECRET}`);

  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
