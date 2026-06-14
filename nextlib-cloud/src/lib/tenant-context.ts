import { eq, and, gt } from 'drizzle-orm'
import { db } from '@/lib/db'
import { tenants, sessions, users, dailyStats, dailyStatsV2 } from '@/lib/db/schema'
import type { Tenant } from '@/lib/db/schema'

export type { Tenant }

/** Name of the session cookie set by `createSession` (see auth/session.ts). */
const SESSION_COOKIE_NAME = 'nextlib_session'

/**
 * Look up a tenant by their token hash.
 * Used for agent-to-cloud authentication via X-NextLib-Token header.
 *
 * @param tokenHash - SHA-256 hash of the API token
 * @returns The tenant record or null if not found
 */
export async function getTenantFromToken(tokenHash: string): Promise<Tenant | null> {
  if (!tokenHash) {
    return null
  }

  const results = await db
    .select()
    .from(tenants)
    .where(eq(tenants.tokenHash, tokenHash))
    .limit(1)

  return results[0] ?? null
}

/**
 * Extract the tenant for a session-authenticated request.
 *
 * Reads the `nextlib_session` cookie, looks up the session + user, and returns
 * the tenant bound to that user via `users.tenantId`. This is the real,
 * cookie-based resolution — it replaces the previous `X-Tenant-ID` header
 * placeholder which trusted the client.
 *
 * Returns null when:
 *   - the session cookie is missing
 *   - no session row exists for that token
 *   - the session has expired (expires_at <= now)
 *   - the user has no tenant (super_admin with tenantId = null)
 *
 * @param request - The incoming HTTP request carrying the session cookie
 * @returns The tenant record or null if not authenticated / unbound
 */
export async function getTenantFromSession(request: Request): Promise<Tenant | null> {
  // Parse the session cookie from the Cookie header without next/headers,
  // since this runs against a plain Request (route handlers, not React server
  // components where cookies() is available).
  const cookieHeader = request.headers.get('cookie') ?? ''
  const sessionToken = parseCookie(cookieHeader, SESSION_COOKIE_NAME)

  if (!sessionToken) {
    return null
  }

  // Look up the session, ensure it's not expired, and pull the user's tenantId.
  const joined = await db
    .select({ tenantId: users.tenantId })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(and(eq(sessions.id, sessionToken), gt(sessions.expiresAt, new Date())))
    .limit(1)

  if (joined.length === 0) {
    return null
  }

  const { tenantId } = joined[0]
  if (!tenantId) {
    // super_admin (or any user without a tenant binding) has no tenant context.
    return null
  }

  const results = await db
    .select()
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1)

  return results[0] ?? null
}

/**
 * Parse a single cookie value out of a Cookie header.
 * Returns null when the cookie is absent.
 */
function parseCookie(cookieHeader: string, name: string): string | null {
  const prefix = `${name}=`
  for (const part of cookieHeader.split(';')) {
    const trimmed = part.trim()
    if (trimmed.startsWith(prefix)) {
      return decodeURIComponent(trimmed.slice(prefix.length))
    }
  }
  return null
}

/**
 * Returns a scoped query helper that enforces tenant_id filtering.
 * All queries through this helper are automatically limited to the given tenant.
 *
 * This prevents cross-tenant data access by always applying a WHERE tenant_id = ? filter.
 *
 * @param tenantId - The tenant UUID to scope queries to
 * @returns An object with methods for tenant-scoped database operations
 */
export function withTenantScope(tenantId: string) {
  return {
    /** The tenant ID this scope is bound to */
    tenantId,

    /** Get the tenant_id equality condition for use in Drizzle where clauses */
    tenantFilter() {
      return eq(dailyStats.tenantId, tenantId)
    },

    /**
     * Query daily stats scoped to this tenant.
     * Always filters by tenant_id to enforce data isolation.
     */
    async getDailyStats() {
      return db
        .select()
        .from(dailyStats)
        .where(eq(dailyStats.tenantId, tenantId))
    },

    /**
     * Query daily stats for a specific date, scoped to this tenant.
     */
    async getDailyStatsByDate(date: string) {
      const { and } = await import('drizzle-orm')
      return db
        .select()
        .from(dailyStats)
        .where(and(eq(dailyStats.tenantId, tenantId), eq(dailyStats.date, date)))
    },

    /**
     * Insert daily stats with the tenant_id automatically set.
     * Ensures the record is always associated with the correct tenant.
     */
    async insertDailyStat(data: { date: string; visitorCount: number; loanCount: number; returnCount: number }) {
      return db
        .insert(dailyStats)
        .values({
          tenantId,
          date: data.date,
          visitorCount: data.visitorCount,
          loanCount: data.loanCount,
          returnCount: data.returnCount,
        })
        .returning()
    },

    /**
     * Query daily stats V2 scoped to this tenant.
     */
    async getDailyStatsV2() {
      return db
        .select()
        .from(dailyStatsV2)
        .where(eq(dailyStatsV2.tenantId, tenantId))
    },

    /**
     * Query daily stats V2 for a specific date, scoped to this tenant.
     */
    async getDailyStatsV2ByDate(date: string) {
      const { and } = await import('drizzle-orm')
      return db
        .select()
        .from(dailyStatsV2)
        .where(and(eq(dailyStatsV2.tenantId, tenantId), eq(dailyStatsV2.date, date)))
    },

    /**
     * Insert daily stats V2 with the tenant_id automatically set.
     */
    async insertDailyStatV2(data: {
      date: string
      visitorCount: number
      uniqueVisitorCount: number
      loanCount: number
      returnCount: number
      newMemberCount: number
      newBiblioCount: number
      newItemCount: number
      finesDebetTotal: number
      finesCreditTotal: number
      reservationCount: number
      totalCollectionSize: number
      activeMemberCount: number
      activeOverdueCount: number
      anomalyFlags: string[]
    }) {
      return db
        .insert(dailyStatsV2)
        .values({
          tenantId,
          date: data.date,
          visitorCount: data.visitorCount,
          uniqueVisitorCount: data.uniqueVisitorCount,
          loanCount: data.loanCount,
          returnCount: data.returnCount,
          newMemberCount: data.newMemberCount,
          newBiblioCount: data.newBiblioCount,
          newItemCount: data.newItemCount,
          finesDebetTotal: data.finesDebetTotal,
          finesCreditTotal: data.finesCreditTotal,
          reservationCount: data.reservationCount,
          totalCollectionSize: data.totalCollectionSize,
          activeMemberCount: data.activeMemberCount,
          activeOverdueCount: data.activeOverdueCount,
          anomalyFlags: data.anomalyFlags,
        })
        .returning()
    },
  }
}
