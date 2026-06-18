/**
 * Cloud-side client for talking back to a tenant's NextLib-Agent.
 *
 * The dashboard proxy (`/api/v1/proxy/[...path]`) is the existing outbound
 * path, but it is gated behind session auth and capped at a 5-second timeout
 * — both unsuitable for the backfill worker, which runs server-side in a
 * long-lived BullMQ process and needs up to ~30s per `trigger_export` call.
 *
 * This module reproduces just the outbound bits the worker needs:
 *   - decrypt tenant credentials (slimsBaseUrl + apiSecret)
 *   - HMAC-sign the request body (X-NextLib-Token)
 *   - identify the tenant (X-NextLib-Secret-Hash = SHA-256(apiSecret))
 *   - POST to `${slimsBaseUrl}/api/v1/nextlib/agent-command`
 *
 * It deliberately does NOT go through Next.js request handling, so it can be
 * used from the standalone worker process.
 */

import { createHash } from "crypto";
import { decrypt } from "@/lib/crypto";
import { generateToken } from "@/lib/hmac";
import type { Tenant } from "@/lib/db/schema";

/** Per-call timeout for agent export requests. Generous because the agent
 *  re-queries SLiMS per date and may compress + POST back to the cloud. */
const AGENT_EXPORT_TIMEOUT_MS = 30_000;

/** Result of a single trigger_export call. */
export interface AgentExportResult {
  success: boolean;
  /** HTTP status from the agent, or 0 if the request never completed. */
  status: number;
  /** Human-readable error message when success is false. */
  error?: string;
}

/**
 * Trigger the agent to export metrics for a single date.
 *
 * The agent runs its `EnhancedExporter::export($date)` logic for the given
 * date, which in turn POSTs the v1/v2 payloads back to the cloud's
 * `/api/v1/aggregate` and `/api/v2/aggregate` endpoints. So a successful
 * return here means the agent accepted the command — the actual row insert
 * into `daily_stats` happens via those follow-up POSTs.
 *
 * @param tenant        The tenant row (must have encrypted credentials)
 * @param date          Target date in `YYYY-MM-DD` format
 * @param encryptionKey The AES-256 key used to decrypt tenant credentials
 */
export async function triggerAgentExport(
  tenant: Pick<Tenant, "slimsBaseUrl" | "apiSecretEncrypted">,
  date: string,
  encryptionKey: string
): Promise<AgentExportResult> {
  // 1. Decrypt tenant credentials
  let slimsBaseUrl: string;
  let apiSecret: string;
  try {
    slimsBaseUrl = decrypt(tenant.slimsBaseUrl, encryptionKey);
    apiSecret = decrypt(tenant.apiSecretEncrypted, encryptionKey);
  } catch {
    return {
      success: false,
      status: 0,
      error: "Failed to decrypt tenant credentials",
    };
  }

  // 2. Build the agent-command request body
  const body = JSON.stringify({ command: "trigger_export", date });

  // 3. Sign and identify the tenant
  const token = generateToken(body, apiSecret);
  const secretHash = createHash("sha256").update(apiSecret).digest("hex");

  const targetUrl = `${slimsBaseUrl.replace(/\/+$/, "")}/api/v1/nextlib/agent-command`;

  // 4. POST with timeout (the proxy route's 5s cap is too short for export)
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), AGENT_EXPORT_TIMEOUT_MS);

  try {
    const response = await fetch(targetUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-NextLib-Token": token,
        "X-NextLib-Secret-Hash": secretHash,
      },
      body,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    // The agent returns { status: "success" | "failed", message: string }
    // for trigger_export. Treat HTTP 2xx + status:"success" as success.
    if (response.status >= 200 && response.status < 300) {
      try {
        const data = (await response.json()) as { status?: string; message?: string };
        if (data.status === "success") {
          return { success: true, status: response.status };
        }
        return {
          success: false,
          status: response.status,
          error: data.message || `Agent reported status: ${data.status}`,
        };
      } catch {
        // Non-JSON 2xx — treat as success since the agent accepted it.
        return { success: true, status: response.status };
      }
    }

    return {
      success: false,
      status: response.status,
      error: `Agent returned HTTP ${response.status}`,
    };
  } catch (err) {
    clearTimeout(timeoutId);
    const message = err instanceof Error ? err.message : String(err);
    // AbortError → timeout; otherwise network error
    if (err instanceof Error && err.name === "AbortError") {
      return {
        success: false,
        status: 0,
        error: `Agent did not respond within ${AGENT_EXPORT_TIMEOUT_MS / 1000}s`,
      };
    }
    return {
      success: false,
      status: 0,
      error: `Failed to reach agent: ${message}`,
    };
  }
}

/** Shape of one day in the response from the agent's daily-aggregate endpoint. */
export interface DailyAggregateDay {
  date: string;
  daily_metrics: {
    visitor_count: number;
    unique_visitor_count: number;
    loan_count: number;
    return_count: number;
    new_member_count: number;
    new_biblio_count: number;
    new_item_count: number;
    fines_debet_total: number;
    fines_credit_total: number;
    reservation_count: number;
  };
  snapshot_metrics: {
    total_collection_size: number;
    active_member_count: number;
    active_overdue_count: number;
  };
  anomaly_flags: string[];
}

export interface DailyAggregateResponse {
  schema_version: "2.0";
  start_date: string;
  end_date: string;
  days: DailyAggregateDay[];
}

export interface PullAgentResult {
  success: boolean;
  status: number;
  days?: DailyAggregateDay[];
  error?: string;
}

/** Per-call timeout for the pull. Generous because a 366-day range
 *  requires the agent to do ~10 SQL queries + a date-series fill. */
const PULL_TIMEOUT_MS = 60_000;

/**
 * Pull daily aggregate metrics for a date range from the agent.
 *
 * Replaces the old push-based `triggerAgentExport()` flow: instead of
 * asking the agent to compute aggregates and POST them back, we call
 * the agent's read-only /daily-aggregate endpoint and get the data
 * directly. This means the plugin no longer needs its own SLiMS DB
 * credentials.
 *
 * @param tenant        Tenant row (must have encrypted credentials)
 * @param startDate     Inclusive YYYY-MM-DD
 * @param endDate       Inclusive YYYY-MM-DD (range must be ≤ 366 days)
 * @param encryptionKey AES-256 key for decrypting tenant credentials
 */
export async function pullAgentDailyAggregate(
  tenant: Pick<Tenant, "slimsBaseUrl" | "apiSecretEncrypted">,
  startDate: string,
  endDate: string,
  encryptionKey: string
): Promise<PullAgentResult> {
  // 1. Decrypt credentials
  let slimsBaseUrl: string;
  let apiSecret: string;
  try {
    slimsBaseUrl = decrypt(tenant.slimsBaseUrl, encryptionKey);
    apiSecret = decrypt(tenant.apiSecretEncrypted, encryptionKey);
  } catch {
    return { success: false, status: 0, error: "Failed to decrypt tenant credentials" };
  }

  // 2. Build signed request
  const body = JSON.stringify({ start_date: startDate, end_date: endDate });
  const token = generateToken(body, apiSecret);
  const secretHash = createHash("sha256").update(apiSecret).digest("hex");
  const targetUrl = `${slimsBaseUrl.replace(/\/+$/, "")}/api/v1/nextlib/daily-aggregate`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), PULL_TIMEOUT_MS);

  try {
    const response = await fetch(targetUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-NextLib-Token": token,
        "X-NextLib-Secret-Hash": secretHash,
      },
      body,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (response.status >= 200 && response.status < 300) {
      const data = (await response.json()) as DailyAggregateResponse;
      return { success: true, status: response.status, days: data.days };
    }

    let agentError = `Agent returned HTTP ${response.status}`;
    try {
      const errBody = (await response.json()) as { message?: string };
      if (errBody.message) agentError = errBody.message;
    } catch {
      // not JSON
    }
    return { success: false, status: response.status, error: agentError };
  } catch (err) {
    clearTimeout(timeoutId);
    if (err instanceof Error && err.name === "AbortError") {
      return {
        success: false,
        status: 0,
        error: `Agent did not respond within ${PULL_TIMEOUT_MS / 1000}s`,
      };
    }
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, status: 0, error: `Failed to reach agent: ${message}` };
  }
}

/**
 * Per-call timeout for ad-hoc agent analytics queries. Shorter than the
 * export timeout because these are user-facing dashboard requests.
 */
const AGENT_QUERY_TIMEOUT_MS = 15_000;

/**
 * Result of an ad-hoc agent query (e.g. top-books, dead-stock).
 */
export interface AgentQueryResult<T = unknown> {
  success: boolean;
  status: number;
  data?: T;
  error?: string;
}

/**
 * Send a signed POST to an analytics endpoint on the agent and return the
 * parsed JSON response. Used by the cloud's analytics routes to fetch detail
 * data (top books, dead stock, collection stats, member activity) on-demand.
 *
 * Unlike `triggerAgentExport`, this returns the agent's JSON payload rather
 * than just a success/failure flag.
 *
 * @param tenant        Tenant row with encrypted credentials
 * @param path          Endpoint path under /api/v1/nextlib/, e.g. "top-books"
 * @param params        Request body (JSON-serialisable)
 * @param encryptionKey AES key for decrypting tenant credentials
 */
export async function queryAgent<T = unknown>(
  tenant: Pick<Tenant, "slimsBaseUrl" | "apiSecretEncrypted">,
  path: string,
  params: Record<string, unknown>,
  encryptionKey: string
): Promise<AgentQueryResult<T>> {
  let slimsBaseUrl: string;
  let apiSecret: string;
  try {
    slimsBaseUrl = decrypt(tenant.slimsBaseUrl, encryptionKey);
    apiSecret = decrypt(tenant.apiSecretEncrypted, encryptionKey);
  } catch {
    return {
      success: false,
      status: 0,
      error: "Failed to decrypt tenant credentials",
    };
  }

  const body = JSON.stringify(params);
  const token = generateToken(body, apiSecret);
  const secretHash = createHash("sha256").update(apiSecret).digest("hex");

  // Normalise the path: callers may pass "top-books" or "/api/v1/nextlib/top-books".
  const normalizedPath = path.startsWith("/api/v1/nextlib/")
    ? path
    : `/api/v1/nextlib/${path.replace(/^\/+/, "")}`;
  const targetUrl = `${slimsBaseUrl.replace(/\/+$/, "")}${normalizedPath}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), AGENT_QUERY_TIMEOUT_MS);

  try {
    const response = await fetch(targetUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-NextLib-Token": token,
        "X-NextLib-Secret-Hash": secretHash,
      },
      body,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (response.status >= 200 && response.status < 300) {
      const data = (await response.json()) as T;
      return { success: true, status: response.status, data };
    }

    // Try to surface the agent's error message.
    let agentError = `Agent returned HTTP ${response.status}`;
    try {
      const errBody = (await response.json()) as { message?: string };
      if (errBody.message) agentError = errBody.message;
    } catch {
      // not JSON — keep the generic message
    }
    return { success: false, status: response.status, error: agentError };
  } catch (err) {
    clearTimeout(timeoutId);
    if (err instanceof Error && err.name === "AbortError") {
      return {
        success: false,
        status: 0,
        error: `Agent did not respond within ${AGENT_QUERY_TIMEOUT_MS / 1000}s`,
      };
    }
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      status: 0,
      error: `Failed to reach agent: ${message}`,
    };
  }
}

/**
 * Shared helper for cloud route handlers: resolve a tenant's credentials,
 * call an agent analytics endpoint, and return a uniform JSON response.
 *
 * - 401 if not authenticated
 * - 403 if the user has no tenant
 * - 503 if the agent is unreachable (with a friendly fallback message)
 * - 200 with the agent's payload otherwise
 */
export async function callAgentAnalytics(
  tenantId: string,
  path: string,
  params: Record<string, unknown>
): Promise<{ status: number; body: unknown }> {
  const encryptionKey = process.env.AES_256_ENCRYPTION_KEY;
  if (!encryptionKey) {
    return {
      status: 500,
      body: {
        error: true,
        code: "SERVER_ERROR",
        message: "Encryption key not configured",
      },
    };
  }

  // Lazy import to avoid pulling the DB module into worker bundles.
  const { db } = await import("@/lib/db");
  const { tenants } = await import("@/lib/db/schema");
  const { eq } = await import("drizzle-orm");

  const rows = await db
    .select({
      slimsBaseUrl: tenants.slimsBaseUrl,
      apiSecretEncrypted: tenants.apiSecretEncrypted,
    })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);

  if (rows.length === 0) {
    return {
      status: 404,
      body: { error: true, code: "TENANT_NOT_FOUND", message: "Tenant not found" },
    };
  }

  const result = await queryAgent(rows[0], path, params, encryptionKey);
  if (!result.success) {
    return {
      status: 503,
      body: {
        error: true,
        code: "AGENT_UNREACHABLE",
        message:
          "Sistem internal perpustakaan kampus sedang tidak dapat dihubungi. Coba lagi nanti.",
        detail: result.error,
      },
    };
  }

  return { status: 200, body: result.data };
}
