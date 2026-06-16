import { NextResponse } from "next/server";
import { randomBytes, createHash } from "crypto";
import { db } from "@/lib/db";
import { tenants } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { ZipArchive } from "archiver";
import { getSessionUser } from "@/lib/auth/session";
import { checkTenantAccess } from "@/lib/tenant-access-guard";
import { checkRateLimit } from "@/lib/rate-limit";
import { writeAuditLog } from "@/lib/tenant-audit";
import { encrypt } from "@/lib/crypto";

/**
 * GET /api/v1/tenants/[id]/agent-zip
 *
 * Builds and streams a per-tenant ZIP of the NextLib-Agent plugin with a
 * pre-baked .env file. The download:
 *   1. Authenticates + checks ownership (tenant_admin or super_admin)
 *   2. Rate-limits (5/hour per user — same bucket as regenerate-secret to
 *      avoid giving the user two ways to abuse token rotation)
 *   3. **Regenerates** the API token (old token immediately invalid)
 *   4. Writes audit log (regenerate_secret, old/new redacted)
 *   5. Streams ZIP with: all source files + pre-baked .env + INSTALL.md
 *
 * Response: application/zip stream. Filename:
 *   nextlib-agent-tenant-<slug>-<date>.zip
 *
 * The download itself is the action — no body required. The client just
 * GETs this URL and the browser triggers the download.
 */
export async function GET(
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
  const access = checkTenantAccess(sessionUser.user as any, id);
  if (!access.allowed) {
    return NextResponse.json(
      { error: true, code: access.code, message: access.message },
      { status: access.status }
    );
  }

  // 2. Rate limit (shared bucket with regenerate-secret)
  const rl = await checkRateLimit(sessionUser.user.id, {
    name: "regen-secret",
    limit: 5,
    windowSec: 3600,
  });
  if (!rl.allowed) {
    return NextResponse.json(
      { error: true, code: "RATE_LIMITED", message: "Too many agent downloads", resetSec: rl.resetSec },
      { status: 429, headers: { "Retry-After": String(rl.resetSec) } }
    );
  }

  // 3. Fetch tenant
  const [tenant] = await db
    .select()
    .from(tenants)
    .where(eq(tenants.id, id))
    .limit(1);
  if (!tenant) {
    return NextResponse.json(
      { error: true, code: "NOT_FOUND", message: "Tenant not found" },
      { status: 404 }
    );
  }

  const encryptionKey = process.env.AES_256_ENCRYPTION_KEY;
  if (!encryptionKey) {
    return NextResponse.json(
      { error: true, code: "SERVER_ERROR", message: "Encryption key not configured" },
      { status: 500 }
    );
  }

  // 4. Generate new API token
  const apiSecret = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(apiSecret).digest("hex");
  const apiSecretEncrypted = encrypt(apiSecret, encryptionKey);

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
      reason: "agent-zip-download",
    },
  });

  // 6. Build ZIP
  const cloudBaseUrl = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
  const envContent = buildEnvFile({
    apiSecret,
    tenantId: id,
    cloudBaseUrl,
    tenantSlug: tenant.slug,
  });
  const installContent = buildInstallMd({
    tenantName: tenant.name,
    tenantSlug: tenant.slug,
  });

  // Read all plugin source files at ZIP build time
  // (In Next.js, server bundle is at process.cwd + /nextlib-agent/)
  // We use the build-time copied source from the deployed Docker image
  const pluginSourcePath = await getPluginSourcePath();

  const archive = new ZipArchive({ zlib: { level: 9 } });
  const webStream = new ReadableStream({
    start(controller) {
      archive.on("data", (chunk: Buffer) => controller.enqueue(chunk));
      archive.on("end", () => controller.close());
      archive.on("error", (err: Error) => controller.error(err));

      // 1. Plugin source files
      archive.directory(pluginSourcePath, "nextlib-agent");

      // 2. Pre-baked .env (overrides any existing .env in the source)
      archive.append(envContent, { name: "nextlib-agent/.env" });

      // 3. INSTALL.md (overrides the one in source if present)
      archive.append(installContent, { name: "nextlib-agent/INSTALL.md" });

      // 4. Top-level INSTALL.md for convenience
      archive.append(installContent, { name: "INSTALL.md" });

      archive.finalize();
    },
  });

  const today = new Date().toISOString().slice(0, 10);
  const filename = `nextlib-agent-tenant-${tenant.slug}-${today}.zip`;

  return new Response(webStream, {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

/**
 * Locate the nextlib-agent source on disk at request time.
 *
 * In production (Docker), the source is at /app/../nextlib-agent/ relative
 * to the Next.js server bundle. In development, it's at the project root.
 */
async function getPluginSourcePath(): Promise<string> {
  const { existsSync } = await import("fs");
  const { resolve } = await import("path");

  const candidates = [
    resolve(process.cwd(), "nextlib-agent"),
    resolve(process.cwd(), "..", "nextlib-agent"),
    resolve(process.cwd(), "../..", "nextlib-agent"),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate) && existsSync(resolve(candidate, "nextlib-agent.plugin.php"))) {
      return candidate;
    }
  }

  throw new Error(
    "nextlib-agent source not found in any expected location. " +
    "Looked in: " + candidates.join(", ")
  );
}

/**
 * Build the .env file content for the per-tenant plugin.
 */
function buildEnvFile(opts: {
  apiSecret: string;
  tenantId: string;
  cloudBaseUrl: string;
  tenantSlug: string;
}): string {
  const { apiSecret, tenantId, cloudBaseUrl, tenantSlug } = opts;
  const today = new Date().toISOString().slice(0, 10);
  return `# NextLib-Agent Configuration
# Auto-generated by NextLib Cloud on ${today} for tenant: ${tenantSlug}
#
# SECURITY: This file contains the API token. Do NOT commit to git.
# Do NOT share. Delete this ZIP after install if you're paranoid.
# You can regenerate this file at any time from the SaaS dashboard.

# HMAC-SHA256 secret for /api/v1/nextlib/* token validation
NEXTLIB_TOKEN_SECRET=${apiSecret}

# Tenant identifier (matches the tenant_id in the cloud DB)
NEXTLIB_TENANT_ID=${tenantId}

# NextLib Cloud base URL — the plugin calls this when pushing data
NEXTLIB_CLOUD_URL=${cloudBaseUrl}

# Token expiry window in seconds (default: 5 minutes)
NEXTLIB_TOKEN_MAX_AGE=300

# HTTP client timeout in seconds
NEXTLIB_HTTP_TIMEOUT=5

# Debug mode (0 = off, 1 = on). Leave off in production.
NEXTLIB_DEBUG=0
`;
}

/**
 * Build the INSTALL.md content for the per-tenant plugin.
 */
function buildInstallMd(opts: { tenantName: string; tenantSlug: string }): string {
  const { tenantName, tenantSlug } = opts;
  return `# NextLib-Agent Install Guide
# Tenant: ${tenantName} (${tenantSlug})

## Install (3 steps)

1. Login to your SLiMS admin panel
2. Navigate to **Admin → Plugins**
3. Click **"Upload"** and select \`nextlib-agent/\` (or the entire ZIP)
4. SLiMS extracts the plugin to \`plugins/nextlib-agent/\`
5. Click **"Activate"** next to the new NextLib-Agent entry

That's it. No Apache/Nginx config needed. The plugin auto-registers
its API routes with SLiMS's existing /api/v1/ front controller via
the \`custom_api_route\` hook.

## Verify

From the NextLib Cloud dashboard:
- Go to **/koneksi**
- Click **"Test Koneksi"**
- You should see ✅ Connected

Or via curl:
\`\`\`bash
curl https://YOUR-SLiMS-DOMAIN/api/v1/nextlib/health
# Expected: {"status":"healthy","database":{"connected":true,...}}
\`\`\`

## Troubleshooting

- **Plugin not visible in Admin → Plugins**: Check that the \`nextlib-agent/\`
  folder contains \`nextlib-agent.plugin.php\` (the file with the plugin
  metadata header). SLiMS's plugin loader uses \`strpos($path, 'plugin.php')\`
  to detect plugins.

- **Health endpoint returns 404**: Your SLiMS version is older than Bulian,
  or the \`custom_api_route\` hook is not firing. Run \`SELECT version()\` on
  your SLiMS DB to check.

- **HMAC 401 errors**: The .env in the plugin folder was overwritten or
  is missing. Re-download the ZIP from the SaaS dashboard and re-upload.

## Uninstall

1. Admin → Plugins → NextLib-Agent → **Deactivate**
2. Delete the folder \`plugins/nextlib-agent/\`
3. (Optional) Go to SaaS dashboard → regenerate the API token to invalidate
   any copies still in use

## Security notes

- The \`.env\` file in this folder contains a 64-character hex API token.
  Treat it as a password. Do not commit, share, or paste in chat.
- The plugin folder is in SLiMS's \`plugins/\` directory. SLiMS \`.htaccess\`
  rules prevent direct web access to \`config.php\` and \`.env\`.
- Each \`custom_api_route\` request must include \`X-NextLib-Token\` and
  \`X-NextLib-Secret-Hash\` headers. Tokens expire after 5 minutes.
`;
}
