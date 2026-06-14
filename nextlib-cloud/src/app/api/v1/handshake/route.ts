import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { tenants } from '@/lib/db/schema'
import { authenticateAgent } from '@/middleware/tenant-guard'

/**
 * POST /api/v1/handshake
 *
 * Receives a handshake ping from the NextLib-Agent to confirm connectivity.
 * - Authenticates the request using HMAC-SHA256 token (via authenticateAgent)
 * - Expects body: { "action": "ping" }
 * - On success: updates tenant status to "connected" and returns tenant name
 * - On invalid/expired token: returns 401 (handled by authenticateAgent)
 *
 * Requirements: 7.4
 */
export async function POST(request: Request) {
  // 1. Authenticate request using agent token
  const authResult = await authenticateAgent(request)

  if (!authResult.success) {
    return authResult.response
  }

  const { tenant } = authResult.context

  // 2. Validate request body
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      {
        error: true,
        code: 'INVALID_BODY',
        message: 'Request body must be valid JSON',
      },
      { status: 400 }
    )
  }

  if (
    !body ||
    typeof body !== 'object' ||
    !('action' in body) ||
    (body as { action: unknown }).action !== 'ping'
  ) {
    return NextResponse.json(
      {
        error: true,
        code: 'INVALID_ACTION',
        message: 'Request body must contain { "action": "ping" }',
      },
      { status: 400 }
    )
  }

  // 3. Update tenant status to "connected"
  try {
    await db
      .update(tenants)
      .set({
        status: 'connected',
        updatedAt: new Date(),
      })
      .where(eq(tenants.id, tenant.id))
  } catch (error: unknown) {
    console.error('Error updating tenant status:', error)
    return NextResponse.json(
      {
        error: true,
        code: 'SERVER_ERROR',
        message: 'Failed to update connection status',
      },
      { status: 500 }
    )
  }

  // 4. Return success response
  return NextResponse.json({
    status: 'ok',
    tenant_name: tenant.name,
  })
}
