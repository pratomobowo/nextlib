import { NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { z } from 'zod/v4'
import { db } from '@/lib/db'
import { tenants, dailyStats } from '@/lib/db/schema'
import { encrypt, decrypt } from '@/lib/crypto'
import { authenticateSession } from '@/middleware/tenant-guard'
import { getSessionUser } from '@/lib/auth/session'
import { checkRateLimit } from '@/lib/rate-limit'
import { writeAuditLog } from '@/lib/tenant-audit'
import { checkTenantAccess } from '@/lib/tenant-access-guard'

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
 * Self-service update of tenant configuration fields.
 *
 * Body: {
 *   name?: string (1..255 chars),
 *   slims_base_url?: string (valid URL),
 *   status?: 'pending' | 'connected' | 'disconnected',
 *   expectedUpdatedAt?: string (ISO datetime, for optimistic concurrency)
 * }
 *
 * Auth rules (via checkTenantAccess):
 *  - super_admin: any tenant
 *  - tenant_admin / librarian: own tenant only
 *
 * Rate limited: 30 requests / 60s / user.
 *
 * For every field that actually changes, an audit log row is written
 * (writeAuditLog) BEFORE the DB update. This is intentional: the audit
 * log is the security record of attempted changes, and an "orphan" log
 * entry (change attempted but DB update failed) is preferable to an
 * untracked change. See Task 5 design notes.
 *
 * Status codes: 200, 400, 401, 403, 404, 409, 429, 500.
 */
const patchSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  slims_base_url: z.string().url().optional(),
  status: z.enum(['pending', 'connected', 'disconnected']).optional(),
  expectedUpdatedAt: z.string().datetime().optional(),
})

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  // 1. Auth
  const sessionUser = await getSessionUser()
  if (!sessionUser) {
    return NextResponse.json(
      { error: true, code: 'UNAUTHORIZED', message: 'Authentication required' },
      { status: 401 }
    )
  }
  const access = checkTenantAccess(sessionUser.user, id)
  if (!access.allowed) {
    return NextResponse.json(
      { error: true, code: access.code, message: access.message },
      { status: access.status }
    )
  }

  // 2. Rate limit
  const rl = await checkRateLimit(sessionUser.user.id, {
    name: 'patch-tenant',
    limit: 30,
    windowSec: 60,
  })
  if (!rl.allowed) {
    return NextResponse.json(
      {
        error: true,
        code: 'RATE_LIMITED',
        message: 'Too many requests',
        resetSec: rl.resetSec,
      },
      { status: 429, headers: { 'Retry-After': String(rl.resetSec) } }
    )
  }

  // 3. Parse + validate
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { error: true, code: 'INVALID_JSON', message: 'Body must be valid JSON' },
      { status: 400 }
    )
  }
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: true,
        code: 'VALIDATION_ERROR',
        message: 'Invalid input',
        details: parsed.error.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      },
      { status: 400 }
    )
  }

  const { name, slims_base_url, status, expectedUpdatedAt } = parsed.data
  if (!name && !slims_base_url && !status) {
    return NextResponse.json(
      { error: true, code: 'NO_OP', message: 'No fields to update' },
      { status: 400 }
    )
  }

  // 4. Fetch existing
  const [existing] = await db
    .select()
    .from(tenants)
    .where(eq(tenants.id, id))
    .limit(1)
  if (!existing) {
    return NextResponse.json(
      { error: true, code: 'NOT_FOUND', message: 'Tenant not found' },
      { status: 404 }
    )
  }

  // 5. Optimistic concurrency
  if (expectedUpdatedAt && existing.updatedAt.toISOString() !== expectedUpdatedAt) {
    return NextResponse.json(
      {
        error: true,
        code: 'STALE_WRITE',
        message: 'Data has changed since you loaded it',
      },
      { status: 409 }
    )
  }

  // 6. Build update set + write per-field audit logs
  const update: Partial<typeof tenants.$inferInsert> = { updatedAt: new Date() }
  const encryptionKey = process.env.AES_256_ENCRYPTION_KEY
  if (!encryptionKey) {
    return NextResponse.json(
      { error: true, code: 'SERVER_ERROR', message: 'Encryption key not configured' },
      { status: 500 }
    )
  }

  const requestMeta = await getRequestMeta(request)

  if (name && name !== existing.name) {
    update.name = name
    await writeAuditLog({
      tenantId: id,
      actorUserId: sessionUser.user.id,
      actorEmail: sessionUser.user.email,
      action: 'field_update',
      fieldName: 'name',
      oldValue: existing.name,
      newValue: name,
      metadata: requestMeta,
    })
  }
  if (slims_base_url) {
    // Compare plaintexts, not ciphertexts: encrypt() uses a random IV, so
    // the same plaintext produces a different ciphertext each time. A
    // ciphertext compare would always report a "change" and write a
    // spurious audit log row.
    const currentPlain = decrypt(existing.slimsBaseUrl, encryptionKey)
    if (slims_base_url !== currentPlain) {
      const newEncrypted = encrypt(slims_base_url, encryptionKey)
      update.slimsBaseUrl = newEncrypted
      await writeAuditLog({
        tenantId: id,
        actorUserId: sessionUser.user.id,
        actorEmail: sessionUser.user.email,
        action: 'field_update',
        fieldName: 'slims_base_url',
        oldValue: currentPlain,
        newValue: slims_base_url,
        metadata: requestMeta,
      })
    }
  }
  if (status && status !== existing.status) {
    update.status = status
    await writeAuditLog({
      tenantId: id,
      actorUserId: sessionUser.user.id,
      actorEmail: sessionUser.user.email,
      action: 'field_update',
      fieldName: 'status',
      oldValue: existing.status,
      newValue: status,
      metadata: requestMeta,
    })
  }

  if (Object.keys(update).length === 1) {
    // only updatedAt, no real changes — return the current row as-is
    return NextResponse.json({
      data: toResponseShape(existing, encryptionKey, sessionUser.user),
    })
  }

  // 7. Apply
  const [updated] = await db
    .update(tenants)
    .set(update)
    .where(eq(tenants.id, id))
    .returning()
  return NextResponse.json({
    data: toResponseShape(updated, encryptionKey, sessionUser.user),
  })
}

async function getRequestMeta(request: Request): Promise<Record<string, unknown>> {
  return {
    ip:
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
      request.headers.get('x-real-ip') ??
      'unknown',
    userAgent: request.headers.get('user-agent') ?? 'unknown',
  }
}

/**
 * Project a tenant row to the wire format. Decrypts `slims_base_url` only
 * for the owner (user.tenantId === tenant.id); everyone else gets
 * `[ENCRYPTED]` so a `super_admin` cross-tenant view does not leak
 * another tenant's URL. The snake_case field names match the existing
 * GET handler response shape.
 */
function toResponseShape(
  tenant: typeof tenants.$inferSelect,
  encryptionKey: string,
  user: { role: string; tenantId: string | null }
) {
  const isOwner = user.tenantId === tenant.id
  return {
    id: tenant.id,
    name: tenant.name,
    slug: tenant.slug,
    status: tenant.status,
    slims_base_url: isOwner
      ? decrypt(tenant.slimsBaseUrl, encryptionKey)
      : '[ENCRYPTED]',
    created_at: tenant.createdAt,
    updated_at: tenant.updatedAt,
  }
}
