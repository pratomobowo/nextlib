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

/**
 * Error categories returned to the UI so it can show actionable messages
 * instead of a generic "fetch failed" / "404".
 */
type ErrorCategory =
  | "ok"            // 2xx AND SLiMS reports healthy + DB connected
  | "plugin_unhealthy" // 200 but SLiMS says degraded (DB down on SLiMS side)
  | "plugin_not_installed" // 404 (plugin file not loaded by SLiMS)
  | "routing_misconfigured" // 403/405/etc — path reaches SLiMS but not our route
  | "auth_failed"   // 401/403 (HMAC rejected or other auth issue)
  | "server_error"  // 5xx from SLiMS
  | "timeout"       // our 5s abort fired
  | "network_unreachable" // DNS / connection refused / TLS / etc.
  | "blocked"       // Cloudflare/WAF block (typically 403/503 with cf-mitigated)
  | "unknown";

function categorizeError(
  statusCode: number,
  error: string | undefined,
  isAbort: boolean,
  bodyIsJson: boolean,
  bodyLooksLikeDefaultServerPage: boolean
): ErrorCategory {
  if (isAbort) return "timeout";
  if (error) {
    // Network-layer errors
    if (
      error.includes("ENOTFOUND") ||
      error.includes("ECONNREFUSED") ||
      error.includes("ETIMEDOUT") ||
      error.includes("ENETUNREACH") ||
      error.includes("EHOSTUNREACH") ||
      error.includes("ECONNRESET") ||
      error.includes("fetch failed")
    ) {
      return "network_unreachable";
    }
    return "unknown";
  }
  // HTTP status
  if (statusCode === 0) return "network_unreachable";

  // 404: distinguish "plugin not installed" (we got 404 from SLiMS for our
  // route) vs "routing misconfigured" (Apache/Cloudflare returned 404 BEFORE
  // the request reached SLiMS — body is HTML, not JSON).
  if (statusCode === 404) {
    if (!bodyIsJson || bodyLooksLikeDefaultServerPage) {
      return "routing_misconfigured";
    }
    return "plugin_not_installed";
  }
  if (statusCode === 405) return "routing_misconfigured";
  if (statusCode === 401 || statusCode === 403) {
    // 403 could also be Apache deny or Cloudflare challenge. If body is
    // HTML (not JSON), it's likely a proxy/server block, not SLiMS auth.
    if (statusCode === 403 && !bodyIsJson) return "blocked";
    return "auth_failed";
  }
  if (statusCode >= 500) return "server_error";
  if (statusCode >= 200 && statusCode < 300) return "ok";
  return "unknown";
}

const CATEGORY_DETAILS: Record<ErrorCategory, { title: string; suggestion: string }> = {
  ok: {
    title: "Connected",
    suggestion: "Plugin reachable. Ready to install.",
  },
  plugin_unhealthy: {
    title: "Plugin reachable but degraded",
    suggestion:
      "Plugin loaded but its DB connection failed. Check SLiMS server's database connectivity.",
  },
  plugin_not_installed: {
    title: "Plugin not installed at this URL",
    suggestion:
      "Upload the nextlib-agent plugin via SLiMS admin → Plugins → Upload, then Activate it.",
  },
  routing_misconfigured: {
    title: "SLiMS routing misconfigured",
    suggestion:
      "The URL reaches SLiMS but the api/v1/* path isn't routed correctly. Check Apache .htaccess / vhost config or nginx location block.",
  },
  auth_failed: {
    title: "Authentication failed",
    suggestion:
      "The plugin rejected the HMAC token. Regenerate the API token from this page and re-upload the plugin.",
  },
  server_error: {
    title: "SLiMS server error",
    suggestion:
      "The plugin or SLiMS hit an internal error. Check SLiMS error logs.",
  },
  timeout: {
    title: "Connection timed out",
    suggestion:
      "Server didn't respond within 5s. Check firewall, Cloudflare rules, or SLiMS server load.",
  },
  network_unreachable: {
    title: "Cannot reach server",
    suggestion:
      "DNS, connection refused, or TLS error. Verify the URL is correct and the server is reachable from the internet.",
  },
  blocked: {
    title: "Request blocked",
    suggestion:
      "Cloudflare/WAF is blocking the request. Add a security rule to skip WAF for /api/v1/nextlib/* on your Cloudflare dashboard.",
  },
  unknown: {
    title: "Unknown error",
    suggestion: "Inspect the raw response below and check SLiMS logs.",
  },
};

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
  const healthUrl = `${slimsBaseUrl}/api/v1/nextlib/health`;

  // 4. Probe with timeout
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const start = Date.now();
  let success = false;
  let statusCode = 0;
  let error: string | undefined;
  let rawBody = "";
  let slimsHealth: { status?: string; database?: { connected?: boolean; error?: string | null } } | null = null;
  let isAbort = false;

  try {
    const res = await fetch(healthUrl, {
      method: "GET",
      headers: {
        "X-NextLib-Token": token,
        "X-NextLib-Secret-Hash": secretHash,
      },
      signal: controller.signal,
    });
    statusCode = res.status;
    success = res.ok;

  // Try to read the body for diagnostics
  try {
    const text = await res.text();
    rawBody = text.slice(0, 500);
    try {
      slimsHealth = JSON.parse(text);
    } catch {
      // not JSON, that's fine
    }
  } catch {
    // body read failed, ignore
  }
} catch (e) {
    isAbort = e instanceof Error && e.name === "AbortError";
    error = e instanceof Error ? e.message : String(e);
  } finally {
    clearTimeout(timer);
  }
  const responseTimeMs = Date.now() - start;

  // 5. Determine category — for 2xx, check the SLiMS health body for "healthy" status
  let category: ErrorCategory;
  let healthy = false;

  if (statusCode > 0 && slimsHealth) {
    // 2xx with JSON body — use body type + content for categorization
    const bodyIsJson = true;
    const bodyLooksLikeDefaultServerPage = false;
    category = categorizeError(statusCode, error, isAbort, bodyIsJson, bodyLooksLikeDefaultServerPage);
  } else if (statusCode > 0) {
    // 2xx with non-JSON body (unusual but handle it)
    category = categorizeError(statusCode, error, isAbort, false, false);
  } else {
    // 4xx/5xx — use body inspection to disambiguate
    const bodyIsJson = slimsHealth !== null;
    const bodyLooksLikeDefaultServerPage = /<!DOCTYPE|<html|<body|Apache Server at|File not found\./i.test(rawBody);
    category = categorizeError(statusCode, error, isAbort, bodyIsJson, bodyLooksLikeDefaultServerPage);
  }

  if (category === "ok" && slimsHealth) {
    // SLiMS replied 2xx but might still be unhealthy (e.g., DB down on SLiMS side)
    const status = slimsHealth.status;
    const dbConnected = slimsHealth.database?.connected;
    if (status === "healthy" && dbConnected === true) {
      healthy = true;
    } else {
      category = "plugin_unhealthy";
    }
  }

  const details = CATEGORY_DETAILS[category];
  const newStatus =
    category === "ok" && healthy ? "connected" : "disconnected";

  // 6. Persist status
  await db
    .update(tenants)
    .set({ status: newStatus, updatedAt: new Date() })
    .where(eq(tenants.id, id));

  // 7. Audit log
  await writeAuditLog({
    tenantId: id,
    actorUserId: sessionUser.user.id,
    actorEmail: sessionUser.user.email,
    action: "test_connection",
    metadata: {
      success: healthy,
      responseTimeMs,
      statusCode,
      error,
      category,
    },
  });

  return NextResponse.json({
    data: {
      success: healthy,
      responseTimeMs,
      statusCode,
      status: newStatus,
      url: healthUrl,
      category,
      title: details.title,
      suggestion: details.suggestion,
      error: error ?? (slimsHealth?.database?.error ?? null),
      slimsStatus: slimsHealth?.status ?? null,
      slimsDbConnected: slimsHealth?.database?.connected ?? null,
      responseBodyPreview: rawBody || null,
    },
  });
}
