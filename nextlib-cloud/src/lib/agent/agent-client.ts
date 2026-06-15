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
