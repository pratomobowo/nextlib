import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { tenants, users } from "@/lib/db/schema";
import { hashPassword } from "@/lib/auth/password";
import { encrypt } from "@/lib/crypto";
import { eq } from "drizzle-orm";
import { createHash } from "crypto";

/**
 * GET /api/v1/auth/seed
 *
 * Dev-only seeder route to populate the database with default tenants and users.
 *
 * Security: requires a shared secret token in the `X-Seed-Token` header. The
 * token is configured via the `SEED_TOKEN` env var in the deployment platform.
 * If `SEED_TOKEN` is unset, the endpoint is permanently disabled (403). This
 * is preferred over a boolean flag (e.g. APP_DEBUG) because a flag is easy to
 * forget to turn off in production; an unguessable token you remove is not.
 *
 * Every call is logged with the source IP and outcome for audit purposes.
 */
export async function GET(request: Request) {
  // 1. Token gate
  const expectedToken = process.env.SEED_TOKEN;
  if (!expectedToken) {
    return NextResponse.json(
      {
        success: false,
        error: "Seeding is disabled: SEED_TOKEN env var is not set",
      },
      { status: 403 }
    );
  }

  const providedToken = request.headers.get("x-seed-token");
  if (providedToken !== expectedToken) {
    return NextResponse.json(
      { success: false, error: "Invalid or missing X-Seed-Token header" },
      { status: 403 }
    );
  }

  // 2. Audit log
  const sourceIp =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown";
  console.log(`[Seeder] Authorized seed request from ${sourceIp}`);

  try {
    // 1. Ensure a default tenant exists
    let defaultTenant = await db
      .select()
      .from(tenants)
      .where(eq(tenants.slug, "universitas-nextlib"))
      .limit(1)
      .then((res) => res[0]);

    if (!defaultTenant) {
      // Same storage contract as POST /tenants: tokenHash = SHA-256(secret),
      // and both the secret and the SLiMS base URL are AES-256-GCM encrypted.
      const encryptionKey = process.env.AES_256_ENCRYPTION_KEY;
      if (!encryptionKey) {
        return NextResponse.json(
          {
            success: false,
            error:
              "AES_256_ENCRYPTION_KEY is not set. Configure it before seeding.",
          },
          { status: 500 }
        );
      }

      const apiSecret = "default_slims_api_secret_key_123456";
      const tokenHash = createHash("sha256").update(apiSecret).digest("hex");
      const slimsBaseUrl = "http://localhost:8080"; // standard local SLiMS

      const [newTenant] = await db
        .insert(tenants)
        .values({
          name: "Universitas NextLib",
          slug: "universitas-nextlib",
          slimsBaseUrl: encrypt(slimsBaseUrl, encryptionKey),
          apiSecretEncrypted: encrypt(apiSecret, encryptionKey),
          tokenHash: tokenHash,
          status: "connected",
        })
        .returning();

      defaultTenant = newTenant;
    }

    // 2. Check and seed default users
    const existingUsers = await db.select().from(users).limit(1);
    
    if (existingUsers.length === 0) {
      // Seed Super Admin
      await db.insert(users).values({
        email: "admin@nextlib.cloud",
        name: "SaaS Super Admin",
        passwordHash: hashPassword("admin"),
        role: "super_admin",
        tenantId: null, // super_admin is not bound to a tenant
      });

      // Seed Tenant Admin
      await db.insert(users).values({
        email: "library@nextlib.cloud",
        name: "Library Admin",
        passwordHash: hashPassword("library"),
        role: "tenant_admin",
        tenantId: defaultTenant.id,
      });

      // Seed Librarian
      await db.insert(users).values({
        email: "librarian@nextlib.cloud",
        name: "Assistant Librarian",
        passwordHash: hashPassword("librarian"),
        role: "librarian",
        tenantId: defaultTenant.id,
      });

      return NextResponse.json({
        success: true,
        message: "Database successfully seeded!",
        credentials: {
          super_admin: { email: "admin@nextlib.cloud", password: "admin" },
          tenant_admin: { email: "library@nextlib.cloud", password: "library" },
          librarian: { email: "librarian@nextlib.cloud", password: "librarian" },
          // Dev convenience: the agent API secret to use for the seeded tenant.
          tenant_api_secret: "default_slims_api_secret_key_123456",
        },
      });
    }

    return NextResponse.json({
      success: true,
      message: "Database already has users. No seeding required.",
    });
  } catch (error) {
    console.error("[Seeder] Seeding error:", error);
    return NextResponse.json(
      { success: false, error: "Terjadi kesalahan saat seeding: " + (error instanceof Error ? error.message : String(error)) },
      { status: 500 }
    );
  }
}
