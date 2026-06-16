import { NextResponse } from "next/server";
import { randomBytes, createHash } from "crypto";
import { db } from "@/lib/db";
import { tenants } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { z } from "zod/v4";
import { getSessionUser } from "@/lib/auth/session";
import { checkRateLimit } from "@/lib/rate-limit";
import { writeAuditLog } from "@/lib/tenant-audit";
import { checkTenantAccess } from "@/lib/tenant-access-guard";
import { encrypt } from "@/lib/crypto";

const bodySchema = z.object({ confirm: z.literal(true) });

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // 1. Auth
  const sessionUser = await getSessionUser();
  if (!sessionUser) {
    return NextResponse.json(
      { error: true, code: "UNAUTHORIZED", message: "Authentication required" },
      { status: 401 }
    );
  }
  const access = checkTenantAccess(sessionUser.user, id);
  if (!access.allowed) {
    return NextResponse.json(
      { error: true, code: access.code, message: access.message },
      { status: access.status }
    );
  }

  // 2. Rate limit
  const rl = await checkRateLimit(sessionUser.user.id, {
    name: "regen-secret",
    limit: 5,
    windowSec: 3600,
  });
  if (!rl.allowed) {
    return NextResponse.json(
      { error: true, code: "RATE_LIMITED", message: "Too many regenerate requests", resetSec: rl.resetSec },
      { status: 429, headers: { "Retry-After": String(rl.resetSec) } }
    );
  }

  // 3. Validate body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: true, code: "CONFIRMATION_REQUIRED", message: "Body must be { confirm: true }" },
      { status: 400 }
    );
  }

  // 4. Generate + persist
  const apiSecret = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(apiSecret).digest("hex");
  const apiSecretEncrypted = encrypt(apiSecret, process.env.AES_256_ENCRYPTION_KEY!);

  await db
    .update(tenants)
    .set({ apiSecretEncrypted, tokenHash, updatedAt: new Date() })
    .where(eq(tenants.id, id));

  // 5. Audit log
  await writeAuditLog({
    tenantId: id,
    actorUserId: sessionUser.user.id,
    actorEmail: sessionUser.user.email,
    action: "regenerate_secret",
    oldValue: "[REDACTED]",
    newValue: "[REDACTED]",
    metadata: {
      ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown",
      userAgent: request.headers.get("user-agent") ?? "unknown",
    },
  });

  return NextResponse.json({
    data: {
      api_token: apiSecret,
      message: "Token lama langsung tidak berlaku. Update plugin NextLib-Agent di SLiMS dalam 24 jam.",
    },
  });
}
