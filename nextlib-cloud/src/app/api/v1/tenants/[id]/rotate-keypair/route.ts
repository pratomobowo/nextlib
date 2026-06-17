import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { tenants } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { getSessionUser } from "@/lib/auth/session";
import { checkTenantAccess } from "@/lib/tenant-access-guard";
import { checkRateLimit } from "@/lib/rate-limit";
import { writeAuditLog } from "@/lib/tenant-audit";
import { generateEd25519Keypair, encrypt } from "@/lib/crypto";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const sessionUser = await getSessionUser();
  if (!sessionUser) {
    return NextResponse.json(
      { error: true, code: "UNAUTHORIZED", message: "Authentication required" },
      { status: 401 }
    );
  }
  const access = checkTenantAccess(sessionUser.user as any, id);
  if (!access.allowed) {
    return NextResponse.json(
      { error: true, code: access.code, message: access.message },
      { status: access.status }
    );
  }

  const rl = await checkRateLimit(sessionUser.user.id, {
    name: "rotate-key",
    limit: 3,
    windowSec: 3600,
  });
  if (!rl.allowed) {
    return NextResponse.json(
      {
        error: true,
        code: "RATE_LIMITED",
        message: "Too many key rotations",
        resetSec: rl.resetSec,
      },
      { status: 429, headers: { "Retry-After": String(rl.resetSec) } }
    );
  }

  const encryptionKey = process.env.AES_256_ENCRYPTION_KEY;
  if (!encryptionKey) {
    return NextResponse.json(
      { error: true, code: "SERVER_ERROR", message: "Encryption key not configured" },
      { status: 500 }
    );
  }

  const kp = generateEd25519Keypair();
  const privateKeyEncrypted = encrypt(kp.privateKey, encryptionKey);
  const rotatedAt = new Date();

  await db
    .update(tenants)
    .set({
      ed25519PublicKey: kp.publicKey,
      ed25519PrivateKeyEncrypted: privateKeyEncrypted,
      ed25519RotatedAt: rotatedAt,
      ed25519KeyId: randomUUID(),
      updatedAt: rotatedAt,
    })
    .where(eq(tenants.id, id));

  await writeAuditLog({
    tenantId: id,
    actorUserId: sessionUser.user.id,
    actorEmail: sessionUser.user.email,
    action: "regenerate_secret",
    oldValue: "[REDACTED]",
    newValue: "[REDACTED]",
    metadata: { reason: "ed25519-keypair-rotation" },
  });

  return NextResponse.json({
    data: {
      publicKey: kp.publicKey,
      rotatedAt: rotatedAt.toISOString(),
    },
  });
}
