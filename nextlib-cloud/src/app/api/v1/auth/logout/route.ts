import { NextResponse } from "next/server";
import { destroySession } from "@/lib/auth/session";

/**
 * POST /api/v1/auth/logout
 *
 * Destroys the active session and clears the cookie.
 */
export async function POST() {
  try {
    await destroySession();
    return NextResponse.json({ success: true, message: "Berhasil logout" });
  } catch (error) {
    console.error("[Auth] Logout error:", error);
    return NextResponse.json(
      { success: false, error: "Terjadi kesalahan internal" },
      { status: 500 }
    );
  }
}
