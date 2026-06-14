import { NextRequest, NextResponse } from "next/server";
import { sessionManager, SessionError } from "@/lib/whatsapp/session-manager";

/**
 * GET /api/v1/whatsapp/session?tenantId=xxx
 *
 * Get the current WhatsApp session status for a tenant.
 * Returns session data including status (pending_qr, connected, disconnected).
 */
export async function GET(request: NextRequest) {
  try {
    const tenantId = request.nextUrl.searchParams.get("tenantId");

    if (!tenantId) {
      return NextResponse.json(
        { success: false, data: null, error: "tenantId query parameter is required" },
        { status: 400 }
      );
    }

    const session = await sessionManager.getSessionStatus(tenantId);

    return NextResponse.json({
      success: true,
      data: session,
      error: null,
    });
  } catch (error) {
    console.error("[API] GET /whatsapp/session error:", error);
    return NextResponse.json(
      {
        success: false,
        data: null,
        error: error instanceof Error ? error.message : "Internal server error",
      },
      { status: 500 }
    );
  }
}

/**
 * POST /api/v1/whatsapp/session
 *
 * Initialize a new WhatsApp session for a tenant.
 * Generates a QR code via the Gowa engine for WhatsApp Web pairing.
 *
 * Body: { tenantId: string }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { tenantId } = body;

    if (!tenantId || typeof tenantId !== "string") {
      return NextResponse.json(
        { success: false, data: null, error: "tenantId is required in request body" },
        { status: 400 }
      );
    }

    const result = await sessionManager.initSession(tenantId);

    return NextResponse.json(
      {
        success: true,
        data: {
          qrLink: result.qrLink,
          qrDuration: result.qrDuration,
        },
        error: null,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("[API] POST /whatsapp/session error:", error);

    if (error instanceof SessionError) {
      const statusCode =
        error.code === "SESSION_ALREADY_CONNECTED" ? 409 : 502;
      return NextResponse.json(
        { success: false, data: null, error: error.message },
        { status: statusCode }
      );
    }

    return NextResponse.json(
      {
        success: false,
        data: null,
        error: error instanceof Error ? error.message : "Internal server error",
      },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/v1/whatsapp/session?tenantId=xxx
 *
 * Disconnect a WhatsApp session for a tenant.
 * Logs out from the Gowa engine and updates session status.
 */
export async function DELETE(request: NextRequest) {
  try {
    const tenantId = request.nextUrl.searchParams.get("tenantId");

    if (!tenantId) {
      return NextResponse.json(
        { success: false, data: null, error: "tenantId query parameter is required" },
        { status: 400 }
      );
    }

    await sessionManager.disconnectSession(tenantId);

    return NextResponse.json({
      success: true,
      data: { message: "Sesi WhatsApp berhasil diputus" },
      error: null,
    });
  } catch (error) {
    console.error("[API] DELETE /whatsapp/session error:", error);

    if (error instanceof SessionError) {
      return NextResponse.json(
        { success: false, data: null, error: error.message },
        { status: 404 }
      );
    }

    return NextResponse.json(
      {
        success: false,
        data: null,
        error: error instanceof Error ? error.message : "Internal server error",
      },
      { status: 500 }
    );
  }
}
