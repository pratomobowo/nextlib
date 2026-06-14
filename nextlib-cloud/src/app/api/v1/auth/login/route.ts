import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { verifyPassword } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";

/**
 * POST /api/v1/auth/login
 *
 * Authenticates user credentials and establishes a session.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, password } = body;

    if (!email || !password) {
      return NextResponse.json(
        { success: false, error: "Email dan password wajib diisi" },
        { status: 400 }
      );
    }

    // Find user by email
    const results = await db
      .select()
      .from(users)
      .where(eq(users.email, email.toLowerCase().trim()))
      .limit(1);

    if (results.length === 0) {
      return NextResponse.json(
        { success: false, error: "Email atau password salah" },
        { status: 401 }
      );
    }

    const user = results[0];

    // Verify password
    const isPasswordValid = verifyPassword(password, user.passwordHash);
    if (!isPasswordValid) {
      return NextResponse.json(
        { success: false, error: "Email atau password salah" },
        { status: 401 }
      );
    }

    // Create session & set cookie
    await createSession(user.id);

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
    console.error("[Auth] Login error:", error);
    return NextResponse.json(
      { success: false, error: "Terjadi kesalahan internal" },
      { status: 500 }
    );
  }
}
