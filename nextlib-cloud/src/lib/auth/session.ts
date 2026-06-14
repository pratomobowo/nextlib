import { db } from "@/lib/db";
import { sessions, users, type User, type Session } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { cookies } from "next/headers";

const SESSION_COOKIE_NAME = "nextlib_session";
const SESSION_EXPIRATION_DAYS = 7;

/**
 * Create a new user session in the database and set the session cookie.
 */
export async function createSession(userId: string): Promise<string> {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + SESSION_EXPIRATION_DAYS);

  // Insert session in DB
  const [newSession] = await db
    .insert(sessions)
    .values({
      userId,
      expiresAt,
    })
    .returning();

  const token = newSession.id;

  // Set HTTP-only cookie
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    expires: expiresAt,
    path: "/",
  });

  return token;
}

/**
 * Retrieve user and session details based on the current session cookie.
 * Returns null if the session is invalid, expired, or doesn't exist.
 */
export async function getSessionUser(): Promise<{ user: User; session: Session } | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (!token) return null;

  // Query session from DB
  const results = await db
    .select({
      session: sessions,
      user: users,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(eq(sessions.id, token))
    .limit(1);

  if (results.length === 0) return null;

  const { session, user } = results[0];

  // Check expiration
  if (new Date() > new Date(session.expiresAt)) {
    // Clean up expired session
    await destroySession();
    return null;
  }

  return { user, session };
}

/**
 * Destroy the current session from both the database and the client cookie.
 */
export async function destroySession(): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (token) {
    // Delete from DB
    await db.delete(sessions).where(eq(sessions.id, token));
  }

  // Delete cookie
  try {
    cookieStore.delete(SESSION_COOKIE_NAME);
  } catch (error) {
    // Ignore error if cookie modification is not allowed during Server Component rendering.
    // The session is already deleted from DB, so future validations will fail.
  }
}
