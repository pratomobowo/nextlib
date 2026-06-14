import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";

/**
 * GET /api/v1/auth/me
 *
 * Retrieves the current authenticated user's details.
 */
export async function GET() {
  try {
    const sessionContext = await getSessionUser();

    if (!sessionContext) {
      return NextResponse.json(
        { success: false, error: "Unauthenticated" },
        { status: 401 }
      );
    }

    const { user } = sessionContext;

    return NextResponse.json({
      success: true,
      data: {
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          tenantId: user.tenantId,
        },
      },
    });
  } catch (error) {
    console.error("[Auth] Get current user error:", error);
    return NextResponse.json(
      { success: false, error: "Terjadi kesalahan internal" },
      { status: 500 }
    );
  }
}
