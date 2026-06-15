import { NextResponse } from 'next/server'
import { gunzipSync } from 'zlib'
import { z } from 'zod/v4'
import { authenticateAgent } from '@/middleware/tenant-guard'
import { validateToken } from '@/lib/hmac'
import { decrypt } from '@/lib/crypto'

/**
 * Validation schema for the aggregate payload sent by the NextLib-Agent.
 * Payload contains daily statistics (visitor_count, loan_count, return_count).
 */
const aggregatePayloadSchema = z.object({
  tenant_id: z.string().uuid('tenant_id must be a valid UUID'),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be in YYYY-MM-DD format'),
  stats: z.object({
    visitor_count: z.number().int().min(0, 'visitor_count must be a non-negative integer'),
    loan_count: z.number().int().min(0, 'loan_count must be a non-negative integer'),
    return_count: z.number().int().min(0, 'return_count must be a non-negative integer'),
  }),
  sent_at: z.string().optional(),
})

/**
 * POST /api/v1/aggregate
 *
 * Receives daily aggregate statistics from the NextLib-Agent.
 * - Authenticates request using HMAC-SHA256 token (X-NextLib-Token header)
 * - Decompresses gzip body if Content-Encoding is gzip
 * - Validates JSON payload structure (tenant_id, date, stats)
 * - Verifies tenant_id in payload matches the authenticated tenant
 * - Inserts daily stats into database using tenant-scoped operations
 *
 * Returns:
 * - 200 with { status: "ok" } on success
 * - 401 on invalid/expired token
 * - 400 on invalid payload structure or tenant mismatch
 */
export async function POST(request: Request) {
  // 1. Authenticate request using HMAC-SHA256 token
  const authResult = await authenticateAgent(request)

  if (!authResult.success) {
    return authResult.response
  }

  const { tenant, scope } = authResult.context

  // 2. Read and optionally decompress the request body
  let bodyText: string

  try {
    const contentEncoding = request.headers.get('content-encoding')

    if (contentEncoding === 'gzip') {
      // Decompress gzip body
      const compressedBuffer = Buffer.from(await request.arrayBuffer())
      const decompressed = gunzipSync(compressedBuffer)
      bodyText = decompressed.toString('utf-8')
    } else {
      // Read raw body text
      bodyText = await request.text()
    }
  } catch {
    return NextResponse.json(
      {
        error: true,
        code: 'DECOMPRESSION_ERROR',
        message: 'Failed to decompress request body. Ensure gzip encoding is valid.',
      },
      { status: 400 }
    )
  }

  // 3. Parse JSON payload
  let payload: unknown
  try {
    payload = JSON.parse(bodyText)
  } catch {
    return NextResponse.json(
      {
        error: true,
        code: 'INVALID_JSON',
        message: 'Request body is not valid JSON',
      },
      { status: 400 }
    )
  }

  // 4. Validate payload structure
  const parsed = aggregatePayloadSchema.safeParse(payload)
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: true,
        code: 'VALIDATION_ERROR',
        message: 'Invalid payload structure',
        details: parsed.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      },
      { status: 400 }
    )
  }

  const { tenant_id, date, stats } = parsed.data

  // 5. Verify tenant_id in payload matches the authenticated tenant
  if (tenant_id !== tenant.id) {
    return NextResponse.json(
      {
        error: true,
        code: 'TENANT_MISMATCH',
        message: 'tenant_id in payload does not match authenticated tenant',
      },
      { status: 400 }
    )
  }

  // 6. Validate HMAC signature against the body content
  // The token was already validated for format and expiry by authenticateAgent.
  // Now validate the HMAC signature against the actual body content.
  const token = request.headers.get('x-nextlib-token')!
  const encryptionKey = process.env.AES_256_ENCRYPTION_KEY

  if (!encryptionKey) {
    return NextResponse.json(
      {
        error: true,
        code: 'SERVER_ERROR',
        message: 'Server configuration error',
      },
      { status: 500 }
    )
  }

  try {
    const apiSecret = decrypt(tenant.apiSecretEncrypted, encryptionKey)
    const isValid = validateToken(token, bodyText, apiSecret)

    if (!isValid) {
      return NextResponse.json(
        {
          error: true,
          code: 'INVALID_SIGNATURE',
          message: 'HMAC-SHA256 signature verification failed',
        },
        { status: 401 }
      )
    }
  } catch {
    return NextResponse.json(
      {
        error: true,
        code: 'SERVER_ERROR',
        message: 'Failed to verify token signature',
      },
      { status: 500 }
    )
  }

  // 7. Insert daily stats into database using tenant-scoped operations
  try {
    await scope.insertDailyStat({
      date,
      visitorCount: stats.visitor_count,
      loanCount: stats.loan_count,
      returnCount: stats.return_count,
    })
  } catch (error: unknown) {
    // Handle duplicate entry (same tenant + date) gracefully. Drizzle wraps
    // the driver error in its own Error with the original under `cause`.
    const pgError = error as { code?: string; cause?: { code?: string } }
    const errCode = pgError.code ?? pgError.cause?.code
    if (errCode === '23505') {
      return NextResponse.json(
        {
          error: true,
          code: 'DUPLICATE_ENTRY',
          message: `Aggregate data for date ${date} already exists for this tenant`,
        },
        { status: 409 }
      )
    }

    console.error('Error inserting daily stats:', error)
    return NextResponse.json(
      {
        error: true,
        code: 'SERVER_ERROR',
        message: 'Failed to store aggregate data',
      },
      { status: 500 }
    )
  }

  // 8. Return success
  return NextResponse.json({ status: 'ok' }, { status: 200 })
}
