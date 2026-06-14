import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { tenants, dailyStats } from '@/lib/db/schema'
import { decrypt } from '@/lib/crypto'
import { authenticateSession } from '@/middleware/tenant-guard'

/**
 * GET /api/v1/tenants/:id
 *
 * Retrieves tenant details with tenant isolation enforcement.
 * - Authenticates request via session-based auth
 * - Verifies the requested tenant ID matches the authenticated tenant's ID
 * - Decrypts slims_base_url for display
 * - Never returns api_secret_encrypted or token_hash
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  // 1. Authenticate request using session-based auth
  const authResult = await authenticateSession(request)

  if (!authResult.success) {
    return authResult.response
  }

  const { tenant: authenticatedTenant } = authResult.context
  const { id } = await params

  // 2. Enforce tenant isolation: requested ID must match authenticated tenant's ID
  if (id !== authenticatedTenant.id) {
    return NextResponse.json(
      {
        error: true,
        code: 'FORBIDDEN',
        message: 'You do not have permission to access this tenant',
      },
      { status: 403 }
    )
  }

  try {
    // 3. Retrieve tenant from database
    const [tenant] = await db
      .select()
      .from(tenants)
      .where(eq(tenants.id, id))
      .limit(1)

    if (!tenant) {
      return NextResponse.json(
        {
          error: true,
          code: 'NOT_FOUND',
          message: 'Tenant not found',
        },
        { status: 404 }
      )
    }

    // 4. Decrypt slims_base_url for display
    const encryptionKey = process.env.AES_256_ENCRYPTION_KEY
    if (!encryptionKey) {
      return NextResponse.json(
        {
          error: true,
          code: 'SERVER_ERROR',
          message: 'Encryption key not configured',
        },
        { status: 500 }
      )
    }

    const decryptedBaseUrl = decrypt(tenant.slimsBaseUrl, encryptionKey)

    // 5. Return tenant details without sensitive fields
    return NextResponse.json({
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      slims_base_url: decryptedBaseUrl,
      status: tenant.status,
      created_at: tenant.createdAt,
      updated_at: tenant.updatedAt,
    })
  } catch (error: unknown) {
    console.error('Error retrieving tenant:', error)
    return NextResponse.json(
      {
        error: true,
        code: 'SERVER_ERROR',
        message: 'An unexpected error occurred',
      },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/v1/tenants/:id
 *
 * Deletes a tenant and all related daily_stats records.
 * Returns 200 on success, 404 if tenant not found.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  try {
    // 1. Check if tenant exists
    const [tenant] = await db
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.id, id))
      .limit(1)

    if (!tenant) {
      return NextResponse.json(
        {
          error: true,
          code: 'NOT_FOUND',
          message: 'Tenant not found',
        },
        { status: 404 }
      )
    }

    // 2. Delete related daily_stats first (cascade)
    await db.delete(dailyStats).where(eq(dailyStats.tenantId, id))

    // 3. Delete the tenant
    await db.delete(tenants).where(eq(tenants.id, id))

    return NextResponse.json({
      success: true,
      message: 'Tenant deleted successfully',
    })
  } catch (error: unknown) {
    console.error('Error deleting tenant:', error)
    return NextResponse.json(
      {
        error: true,
        code: 'SERVER_ERROR',
        message: 'An unexpected error occurred while deleting tenant',
      },
      { status: 500 }
    )
  }
}

/**
 * PATCH /api/v1/tenants/:id
 *
 * Updates tenant fields (currently supports status updates).
 * Body: { "status": "disconnected" | "connected" | "pending" }
 * Returns 200 with updated tenant on success, 404 if not found.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  try {
    // 1. Parse request body
    const body = await request.json()
    const { status } = body

    // 2. Validate status value
    const validStatuses = ['pending', 'connected', 'disconnected']
    if (status && !validStatuses.includes(status)) {
      return NextResponse.json(
        {
          error: true,
          code: 'INVALID_INPUT',
          message: `Invalid status. Must be one of: ${validStatuses.join(', ')}`,
        },
        { status: 400 }
      )
    }

    // 3. Check if tenant exists
    const [existing] = await db
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.id, id))
      .limit(1)

    if (!existing) {
      return NextResponse.json(
        {
          error: true,
          code: 'NOT_FOUND',
          message: 'Tenant not found',
        },
        { status: 404 }
      )
    }

    // 4. Build update object
    const updateData: Record<string, unknown> = {
      updatedAt: new Date(),
    }
    if (status) {
      updateData.status = status
    }

    // 5. Update tenant
    const [updated] = await db
      .update(tenants)
      .set(updateData)
      .where(eq(tenants.id, id))
      .returning({
        id: tenants.id,
        name: tenants.name,
        slug: tenants.slug,
        status: tenants.status,
        updatedAt: tenants.updatedAt,
      })

    return NextResponse.json({
      success: true,
      tenant: updated,
    })
  } catch (error: unknown) {
    console.error('Error updating tenant:', error)
    return NextResponse.json(
      {
        error: true,
        code: 'SERVER_ERROR',
        message: 'An unexpected error occurred while updating tenant',
      },
      { status: 500 }
    )
  }
}
