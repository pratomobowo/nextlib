import { NextResponse } from 'next/server'
import { authenticateSession } from '@/middleware/tenant-guard'
import { decrypt } from '@/lib/crypto'
import { generateToken } from '@/lib/hmac'

/**
 * Allowed proxy paths that map to NextLib-Agent endpoints on the SLiMS server.
 * Only these paths can be forwarded; all others are rejected with 404.
 */
const ALLOWED_PATHS = ['search-book', 'member-check', 'extend-book'] as const

/**
 * Fallback error response returned when the campus SLiMS server is unreachable
 * or times out (5-second limit).
 */
const CAMPUS_UNREACHABLE_RESPONSE = {
  error: true,
  code: 'CAMPUS_UNREACHABLE',
  message: 'Maaf, sistem internal perpustakaan kampus sedang dalam pemeliharaan',
} as const

/**
 * Timeout in milliseconds for requests forwarded to the campus SLiMS server.
 */
const PROXY_TIMEOUT_MS = 5000

/**
 * POST /api/v1/proxy/[...path]
 *
 * Stateless proxy router that forwards requests to a tenant's registered SLiMS server.
 * - Authenticates the caller via session (X-Tenant-ID header placeholder)
 * - Validates the requested path against the allowed proxy paths
 * - Retrieves the tenant's SLiMS base URL and API secret (decrypted)
 * - Generates an HMAC-SHA256 token for the forwarded request
 * - Forwards the request with a 5-second timeout
 * - Returns the SLiMS response in-memory (no PII stored to disk/database)
 * - On timeout or network error, returns CAMPUS_UNREACHABLE fallback
 *
 * Requirements: 6.1, 6.5
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ path: string[] }> }
) {
  // 1. Authenticate tenant from session
  const authResult = await authenticateSession(request)

  if (!authResult.success) {
    return authResult.response
  }

  const { tenant } = authResult.context

  // 2. Validate the proxy path
  const { path } = await params
  const proxyPath = path.join('/')

  if (!ALLOWED_PATHS.includes(proxyPath as typeof ALLOWED_PATHS[number])) {
    return NextResponse.json(
      {
        error: true,
        code: 'INVALID_PATH',
        message: `Path "${proxyPath}" is not a supported proxy endpoint`,
      },
      { status: 404 }
    )
  }

  // 3. Decrypt tenant credentials
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

  let slimsBaseUrl: string
  let apiSecret: string

  try {
    slimsBaseUrl = decrypt(tenant.slimsBaseUrl, encryptionKey)
    apiSecret = decrypt(tenant.apiSecretEncrypted, encryptionKey)
  } catch {
    return NextResponse.json(
      {
        error: true,
        code: 'SERVER_ERROR',
        message: 'Failed to decrypt tenant credentials',
      },
      { status: 500 }
    )
  }

  // 4. Read the request body
  let bodyText: string
  try {
    bodyText = await request.text()
  } catch {
    return NextResponse.json(
      {
        error: true,
        code: 'INVALID_BODY',
        message: 'Failed to read request body',
      },
      { status: 400 }
    )
  }

  // 5. Generate HMAC-SHA256 token for the forwarded request
  const token = generateToken(bodyText, apiSecret)

  // 6. Build the target URL on the SLiMS server
  const targetUrl = `${slimsBaseUrl.replace(/\/+$/, '')}/api/v1/nextlib/${proxyPath}`

  // 7. Forward request to the campus SLiMS server with 5s timeout
  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), PROXY_TIMEOUT_MS)

    const slimsResponse = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-NextLib-Token': token,
      },
      body: bodyText,
      signal: controller.signal,
    })

    clearTimeout(timeoutId)

    // 8. Return the SLiMS response as-is (in-memory, no storage)
    const responseData = await slimsResponse.json()
    return NextResponse.json(responseData, { status: slimsResponse.status })
  } catch (error: unknown) {
    // Timeout or network error → return fallback response
    if (error instanceof Error && error.name === 'AbortError') {
      return NextResponse.json(CAMPUS_UNREACHABLE_RESPONSE, { status: 504 })
    }

    // Any other fetch error (network failure, DNS, etc.)
    return NextResponse.json(CAMPUS_UNREACHABLE_RESPONSE, { status: 502 })
  }
}
