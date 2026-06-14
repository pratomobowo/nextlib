/**
 * WhatsApp Session Lifecycle Manager
 *
 * Manages the lifecycle of WhatsApp sessions for tenants:
 * - Initialize session → generates QR code via Gowa
 * - Confirm connection → updates DB with device info
 * - Disconnect → logs out from Gowa and updates DB
 * - Status queries → read from DB
 *
 * Each tenant can have at most 1 active WhatsApp session
 * (enforced by unique index on tenant_id in the schema).
 */

import { db } from "@/lib/db";
import { whatsappSessions, type WhatsappSession } from "@/lib/db/schema";
import { GowaClient, GowaApiError } from "./gowa-client";
import { eq, desc } from "drizzle-orm";

export class SessionManager {
  private gowa: GowaClient;

  constructor(gowaClient?: GowaClient) {
    this.gowa = gowaClient || new GowaClient();
  }

  /**
   * Initialize a new WhatsApp session for a tenant.
   * Creates a pending_qr session record and requests a QR code from Gowa.
   *
   * If a session already exists for this tenant:
   * - If connected → returns error (must disconnect first)
   * - If pending_qr or disconnected → reuses or replaces the existing record
   */
  async initSession(
    tenantId: string
  ): Promise<{ qrLink: string; qrDuration: number }> {
    // Check for existing session
    const existing = await db
      .select()
      .from(whatsappSessions)
      .where(eq(whatsappSessions.tenantId, tenantId))
      .limit(1);

    if (existing.length > 0 && existing[0].status === "connected") {
      throw new SessionError(
        "Tenant sudah memiliki sesi WhatsApp yang aktif. Disconnect terlebih dahulu.",
        "SESSION_ALREADY_CONNECTED"
      );
    }

    // Request QR code from Gowa
    let loginResponse;
    try {
      loginResponse = await this.gowa.login(tenantId);
    } catch (error) {
      if (error instanceof GowaApiError) {
        throw new SessionError(
          `Gagal menghubungi WhatsApp engine: ${error.message}`,
          "GOWA_CONNECTION_ERROR"
        );
      }
      throw error;
    }

    const now = new Date();

    if (existing.length > 0) {
      // Update existing session record
      await db
        .update(whatsappSessions)
        .set({
          status: "pending_qr",
          connectedAt: null,
          disconnectedAt: null,
          updatedAt: now,
        })
        .where(eq(whatsappSessions.tenantId, tenantId));
    } else {
      // Create new session record
      await db.insert(whatsappSessions).values({
        tenantId,
        status: "pending_qr",
        createdAt: now,
        updatedAt: now,
      });
    }

    console.log(
      `[SessionManager] QR generated for tenant ${tenantId}, duration: ${loginResponse.results.qr_duration}s`
    );

    return {
      qrLink: loginResponse.results.qr_link,
      qrDuration: loginResponse.results.qr_duration,
    };
  }

  /**
   * Confirm that a WhatsApp connection has been established.
   * Called after successful QR scan (typically via webhook or polling).
   */
  async confirmConnection(
    tenantId: string,
    deviceId: string,
    phoneNumber: string
  ): Promise<void> {
    const now = new Date();

    const result = await db
      .update(whatsappSessions)
      .set({
        status: "connected",
        deviceId,
        phoneNumber,
        connectedAt: now,
        disconnectedAt: null,
        updatedAt: now,
      })
      .where(eq(whatsappSessions.tenantId, tenantId))
      .returning({ id: whatsappSessions.id });

    if (result.length === 0) {
      throw new SessionError(
        "Sesi WhatsApp tidak ditemukan untuk tenant ini.",
        "SESSION_NOT_FOUND"
      );
    }

    console.log(
      `[SessionManager] Session confirmed for tenant ${tenantId}: device=${deviceId}, phone=${phoneNumber}`
    );
  }

  /**
   * Disconnect a WhatsApp session.
   * Logs out from Gowa and updates the session record.
   */
  async disconnectSession(tenantId: string): Promise<void> {
    const session = await this.getSessionStatus(tenantId);

    if (!session) {
      throw new SessionError(
        "Sesi WhatsApp tidak ditemukan untuk tenant ini.",
        "SESSION_NOT_FOUND"
      );
    }

    // Attempt to logout from Gowa (best-effort)
    try {
      await this.gowa.logout(session.tenantId);
    } catch (error) {
      console.warn(
        `[SessionManager] Gowa logout failed for tenant ${tenantId} (proceeding with DB update):`,
        error
      );
    }

    const now = new Date();
    await db
      .update(whatsappSessions)
      .set({
        status: "disconnected",
        disconnectedAt: now,
        updatedAt: now,
      })
      .where(eq(whatsappSessions.tenantId, tenantId));

    console.log(
      `[SessionManager] Session disconnected for tenant ${tenantId}`
    );
  }

  /**
   * Get the current session status for a tenant.
   * Returns null if no session exists.
   */
  async getSessionStatus(tenantId: string): Promise<WhatsappSession | null> {
    const sessions = await db
      .select()
      .from(whatsappSessions)
      .where(eq(whatsappSessions.tenantId, tenantId))
      .limit(1);

    return sessions[0] || null;
  }

  /**
   * List all WhatsApp sessions across all tenants.
   * Ordered by most recently updated first.
   */
  async listAllSessions(): Promise<WhatsappSession[]> {
    return db
      .select()
      .from(whatsappSessions)
      .orderBy(desc(whatsappSessions.updatedAt));
  }
}

/**
 * Custom error class for session management errors.
 */
export class SessionError extends Error {
  public code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = "SessionError";
    this.code = code;
  }
}

/**
 * Singleton instance for use across the application.
 */
export const sessionManager = new SessionManager();
