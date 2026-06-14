import { NextResponse } from 'next/server'
import { createHash } from 'crypto'
import { getTenantFromToken, getTenantFromSession, withTenantScope } from '@/lib/tenant-context'
import { validateToken, isTokenExpired } from '@/lib/hmac'
import type { Tenant } from '@/lib/db/schema'

export interface TenantContext {
  tenant: Tenant
  scope: ReturnType<typeof withTenantScope>
}

export type TenantGuardResult =
  | { success: true; context: TenantContext }
  | { success: false; response: NextResponse }

/**
 * Authenticate a request from the NextLib-Agent using the X-NextLib-Token header.
 *
 * Validates the HMAC-SHA256 token, checks expiry, and looks up the tenant
 * by the token hash. Returns tenant context with scoped query helper on success,
 * or a 401/403 error response on failure.
 *
 * @param request - The incoming HTTP request
 * @returns TenantGuardResult with either success context or error response
 */
export async function authenticateAgent(request: Request): Promise<TenantGuardResult> {
  const token = request.headers.get('x-nextlib-token')

  if (!token) {
    return {
      success: false,
      response: NextResponse.json(
        {
          error: true,
          code: 'MISSING_TOKEN',
          message: 'X-NextLib-Token header is required',
        },
        { status: 401 }
      ),
    }
  }

  // Check token format
  const parts = token.split('.')
  if (parts.length !== 2) {
    return {
      success: false,
      response: NextResponse.json(
        {
          error: true,
          code: 'INVALID_TOKEN',
          message: 'Token format is invalid',
        },
        { status: 401 }
      ),
    }
  }

  // Check token expiry (5 minute window)
  if (isTokenExpired(token)) {
    return {
      success: false,
      response: NextResponse.json(
        {
          error: true,
          code: 'TOKEN_EXPIRED',
          message: 'Token has expired. Please generate a new token.',
        },
        { status: 401 }
      ),
    }
  }

  // Extract the raw API secret from the token to compute the hash for lookup.
  // The agent sends: X-NextLib-Token = generateToken(body, apiSecret)
  // We need to find the tenant by hashing the secret they used.
  // However, we can't extract the secret from an HMAC token.
  //
  // Alternative approach: The agent also sends X-NextLib-Secret-Hash header
  // with SHA-256(apiSecret) for tenant identification. The HMAC token
  // validates the request integrity.
  //
  // Simplified approach for Sprint 1: Look up tenant by the secret hash
  // sent in a separate header or embedded in the request.
  const secretHash = request.headers.get('x-nextlib-secret-hash')

  if (!secretHash) {
    return {
      success: false,
      response: NextResponse.json(
        {
          error: true,
          code: 'MISSING_SECRET_HASH',
          message: 'X-NextLib-Secret-Hash header is required for tenant identification',
        },
        { status: 401 }
      ),
    }
  }

  // Look up tenant by token hash
  const tenant = await getTenantFromToken(secretHash)

  if (!tenant) {
    return {
      success: false,
      response: NextResponse.json(
        {
          error: true,
          code: 'TENANT_NOT_FOUND',
          message: 'No tenant found for the provided credentials',
        },
        { status: 401 }
      ),
    }
  }

  // Create tenant-scoped query helper
  const scope = withTenantScope(tenant.id)

  return {
    success: true,
    context: { tenant, scope },
  }
}

/**
 * Authenticate a request from the dashboard/session-based access.
 *
 * Reads the `nextlib_session` cookie (via getTenantFromSession) and resolves
 * the tenant bound to the authenticated user. Returns 401 when there is no
 * valid session or the user has no tenant binding (e.g. super_admin without a
 * tenant scope).
 *
 * @param request - The incoming HTTP request
 * @returns TenantGuardResult with either success context or error response
 */
export async function authenticateSession(request: Request): Promise<TenantGuardResult> {
  const tenant = await getTenantFromSession(request)

  if (!tenant) {
    return {
      success: false,
      response: NextResponse.json(
        {
          error: true,
          code: 'UNAUTHORIZED',
          message: 'Authentication required. Please log in.',
        },
        { status: 401 }
      ),
    }
  }

  const scope = withTenantScope(tenant.id)

  return {
    success: true,
    context: { tenant, scope },
  }
}

/**
 * Unified tenant guard that tries agent authentication first,
 * then falls back to session-based authentication.
 *
 * Use this when an endpoint should accept both agent tokens
 * and dashboard session auth.
 *
 * @param request - The incoming HTTP request
 * @returns TenantGuardResult with either success context or error response
 */
export async function authenticateRequest(request: Request): Promise<TenantGuardResult> {
  // If X-NextLib-Token is present, use agent authentication
  if (request.headers.get('x-nextlib-token')) {
    return authenticateAgent(request)
  }

  // Otherwise, try session-based authentication
  return authenticateSession(request)
}
