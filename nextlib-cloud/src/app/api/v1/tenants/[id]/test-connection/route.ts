import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { tenants } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getSessionUser } from "@/lib/auth/session";
import { checkRateLimit } from "@/lib/rate-limit";
import { writeAuditLog } from "@/lib/tenant-audit";
import { checkTenantAccess } from "@/lib/tenant-access-guard";
import { decrypt } from "@/lib/crypto";
import { generateToken } from "@/lib/hmac";
import { createHash } from "crypto";

const TIMEOUT_MS = 5000;

export async function POST(
  _request: Request,
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
    name: "test-conn",
    limit: 10,
    windowSec: 60,
  });
  if (!rl.allowed) {
    return NextResponse.json(
      { error: true, code: "RATE_LIMITED", message: "Too many test requests", resetSec: rl.resetSec },
      { status: 429, headers: { "Retry-After": String(rl.resetSec) } }
    );
  }

  // 3. Fetch tenant
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, id)).limit(1);
  if (!tenant) {
    return NextResponse.json(
      { error: true, code: "NOT_FOUND", message: "Tenant not found" },
      { status: 404 }
    );
  }

  const encryptionKey = process.env.AES_256_ENCRYPTION_KEY!;
  const slimsBaseUrl = decrypt(tenant.slimsBaseUrl, encryptionKey);
  const apiSecret = decrypt(tenant.apiSecretEncrypted, encryptionKey);
  const token = generateToken("", apiSecret);
  const secretHash = createHash("sha256").update(apiSecret).digest("hex");

  // 4. Probe with timeout
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const start = Date.now();
  let success = false;
  let statusCode = 0;
  let error: string | undefined;

  try {
    const res = await fetch(`${slimsBaseUrl}/api/v1/nextlib/health`, {
      method: "GET",
      headers: {
        "X-NextLib-Token": token,
        "X-NextLib-Secret-Hash": secretHash,
      },
      signal: controller.signal,
    });
    statusCode = res.status;
    success = res.ok;
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  } finally {
    clearTimeout(timer);
  }
  const responseTimeMs = Date.now() - start;
  const newStatus = success ? "connected" : "disconnected";

  // 5. Persist status
  await db
    .update(tenants)
    .set({ status: newStatus, updatedAt: new Date() })
    .where(eq(tenants.id, id));

  // 6. Audit log
  await writeAuditLog({
    tenantId: id,
    actorUserId: sessionUser.user.id,
    actorEmail: sessionUser.user.email,
    action: "test_connection",
    metadata: { success, responseTimeMs, statusCode, error },
  });

  return NextResponse.json({
    data: { success, responseTimeMs, statusCode, status: newStatus, error },
  });
}
