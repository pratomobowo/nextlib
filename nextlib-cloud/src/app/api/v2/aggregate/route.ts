import { NextResponse } from 'next/server'
import { gunzipSync } from 'zlib'
import { z } from 'zod/v4'
import { authenticateAgent } from '@/middleware/tenant-guard'
import { validateToken } from '@/lib/hmac'
import { decrypt } from '@/lib/crypto'
import { computeAnomalyFlags } from '@/lib/analytics/anomaly-detector'

const aggregatePayloadV2Schema = z.object({
  schema_version: z.literal("2.0"),
  tenant_id: z.string().uuid('tenant_id must be a valid UUID'),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be in YYYY-MM-DD format'),
  daily_metrics: z.object({
    visitor_count: z.number().int().min(0, 'visitor_count must be a non-negative integer'),
    unique_visitor_count: z.number().int().min(0, 'unique_visitor_count must be a non-negative integer'),
    loan_count: z.number().int().min(0, 'loan_count must be a non-negative integer'),
    return_count: z.number().int().min(0, 'return_count must be a non-negative integer'),
    new_member_count: z.number().int().min(0, 'new_member_count must be a non-negative integer'),
    new_biblio_count: z.number().int().min(0, 'new_biblio_count must be a non-negative integer'),
    new_item_count: z.number().int().min(0, 'new_item_count must be a non-negative integer'),
    fines_debet_total: z.number().int().min(0, 'fines_debet_total must be a non-negative integer'),
    fines_credit_total: z.number().int().min(0, 'fines_credit_total must be a non-negative integer'),
    reservation_count: z.number().int().min(0, 'reservation_count must be a non-negative integer'),
  }),
  snapshot_metrics: z.object({
    total_collection_size: z.number().int().min(0, 'total_collection_size must be a non-negative integer'),
    active_member_count: z.number().int().min(0, 'active_member_count must be a non-negative integer'),
    active_overdue_count: z.number().int().min(0, 'active_overdue_count must be a non-negative integer'),
  }),
  anomaly_flags: z.array(z.string()),
  sent_at: z.string().optional(),
})

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
      const compressedBuffer = Buffer.from(await request.arrayBuffer())
      const decompressed = gunzipSync(compressedBuffer)
      bodyText = decompressed.toString('utf-8')
    } else {
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
  const parsed = aggregatePayloadV2Schema.safeParse(payload)
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

  const { tenant_id, date, daily_metrics, snapshot_metrics } = parsed.data

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

  // 7. Compute anomaly flags cloud-side. The agent now sends empty flags and
  // relies on the cloud to derive them from stored daily_stats_v2 rows
  // (indexed) — far cheaper than the agent recomputing 30-day baselines by
  // re-querying SLiMS for every historical day.
  let anomalyFlags: string[]
  try {
    anomalyFlags = await computeAnomalyFlags(tenant.id, date, {
      visitorCount: daily_metrics.visitor_count,
      loanCount: daily_metrics.loan_count,
      activeOverdueCount: snapshot_metrics.active_overdue_count,
    })
  } catch (error) {
    console.error('Error computing anomaly flags:', error)
    // Non-fatal: store empty flags rather than failing the whole ingest.
    anomalyFlags = []
  }

  // 8. Insert daily stats into database using tenant-scoped operations
  try {
    await scope.insertDailyStatV2({
      date,
      visitorCount: daily_metrics.visitor_count,
      uniqueVisitorCount: daily_metrics.unique_visitor_count,
      loanCount: daily_metrics.loan_count,
      returnCount: daily_metrics.return_count,
      newMemberCount: daily_metrics.new_member_count,
      newBiblioCount: daily_metrics.new_biblio_count,
      newItemCount: daily_metrics.new_item_count,
      finesDebetTotal: daily_metrics.fines_debet_total,
      finesCreditTotal: daily_metrics.fines_credit_total,
      reservationCount: daily_metrics.reservation_count,
      totalCollectionSize: snapshot_metrics.total_collection_size,
      activeMemberCount: snapshot_metrics.active_member_count,
      activeOverdueCount: snapshot_metrics.active_overdue_count,
      anomalyFlags,
    })
  } catch (error: unknown) {
    // Drizzle wraps the driver error in its own Error with the original
    // under `cause`. Handle duplicate (tenant_id, date) as 409.
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

    console.error('Error inserting daily stats v2:', error)
    return NextResponse.json(
      {
        error: true,
        code: 'SERVER_ERROR',
        message: 'Failed to store aggregate data',
      },
      { status: 500 }
    )
  }

  return NextResponse.json({ status: 'ok' }, { status: 200 })
}
