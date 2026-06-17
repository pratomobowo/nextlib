import { describe, it, expect, vi, beforeEach } from 'vitest'
import { gzipSync } from 'zlib'
import { createHmac, createHash } from 'crypto'
import { POST } from './route'

// Mock tenant data
const MOCK_TENANT_ID = '123e4567-e89b-12d3-a456-426614174000'
const MOCK_API_SECRET = 'a'.repeat(64)
const MOCK_TOKEN_HASH = createHash('sha256').update(MOCK_API_SECRET).digest('hex')
const MOCK_ENCRYPTION_KEY = 'b'.repeat(64)

// Helper to generate a valid HMAC token
function generateToken(body: string, secret: string): string {
  const timestamp = Math.floor(Date.now() / 1000).toString()
  const signature = createHmac('sha256', secret)
    .update(timestamp + body)
    .digest('hex')
  return `${timestamp}.${signature}`
}

// Mock modules
const mockInsertDailyStat = vi.fn().mockResolvedValue([{ id: 'stat-1' }])

vi.mock('@/middleware/tenant-guard', () => ({
  authenticateAgent: vi.fn(),
}))

vi.mock('@/lib/hmac', () => ({
  validateToken: vi.fn(),
  isTokenExpired: vi.fn(),
}))

vi.mock('@/lib/crypto', () => ({
  decrypt: vi.fn(),
}))

// Import mocked modules for manipulation
import { authenticateAgent } from '@/middleware/tenant-guard'
import { validateToken } from '@/lib/hmac'
import { decrypt } from '@/lib/crypto'

const mockAuthenticateAgent = vi.mocked(authenticateAgent)
const mockValidateToken = vi.mocked(validateToken)
const mockDecrypt = vi.mocked(decrypt)

// Set env vars
vi.stubEnv('AES_256_ENCRYPTION_KEY', MOCK_ENCRYPTION_KEY)

function createValidPayload(overrides = {}) {
  return {
    tenant_id: MOCK_TENANT_ID,
    date: '2026-06-12',
    stats: {
      visitor_count: 150,
      loan_count: 45,
      return_count: 38,
    },
    sent_at: '2026-06-12T23:59:00+07:00',
    ...overrides,
  }
}

function setupSuccessfulAuth() {
  mockAuthenticateAgent.mockResolvedValue({
    success: true,
    context: {
      tenant: {
        id: MOCK_TENANT_ID,
        name: 'Test University',
        slug: 'test-uni',
        slimsBaseUrl: 'encrypted-url',
        apiSecretEncrypted: 'encrypted-secret',
        tokenHash: MOCK_TOKEN_HASH,
        ed25519PublicKey: null,
        ed25519PrivateKeyEncrypted: null,
        ed25519RotatedAt: null,
        ed25519KeyId: null,
        status: 'connected',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      scope: {
        tenantId: MOCK_TENANT_ID,
        tenantFilter: vi.fn(),
        getDailyStats: vi.fn(),
        getDailyStatsByDate: vi.fn(),
        insertDailyStat: mockInsertDailyStat,
      },
    },
  })
}

describe('POST /api/v1/aggregate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('AES_256_ENCRYPTION_KEY', MOCK_ENCRYPTION_KEY)
    mockDecrypt.mockReturnValue(MOCK_API_SECRET)
    mockValidateToken.mockReturnValue(true)
  })

  describe('Authentication', () => {
    it('returns 401 when X-NextLib-Token header is missing', async () => {
      const { NextResponse } = await import('next/server')
      mockAuthenticateAgent.mockResolvedValue({
        success: false,
        response: NextResponse.json(
          { error: true, code: 'MISSING_TOKEN', message: 'X-NextLib-Token header is required' },
          { status: 401 }
        ),
      })

      const payload = createValidPayload()
      const body = JSON.stringify(payload)
      const request = new Request('http://localhost:3000/api/v1/aggregate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      })

      const response = await POST(request)
      const responseBody = await response.json()

      expect(response.status).toBe(401)
      expect(responseBody.code).toBe('MISSING_TOKEN')
    })

    it('returns 401 when token is expired', async () => {
      const { NextResponse } = await import('next/server')
      mockAuthenticateAgent.mockResolvedValue({
        success: false,
        response: NextResponse.json(
          { error: true, code: 'TOKEN_EXPIRED', message: 'Token has expired.' },
          { status: 401 }
        ),
      })

      const payload = createValidPayload()
      const body = JSON.stringify(payload)
      const request = new Request('http://localhost:3000/api/v1/aggregate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-NextLib-Token': '1000000000.invalidsig',
          'X-NextLib-Secret-Hash': MOCK_TOKEN_HASH,
        },
        body,
      })

      const response = await POST(request)
      const responseBody = await response.json()

      expect(response.status).toBe(401)
      expect(responseBody.code).toBe('TOKEN_EXPIRED')
    })

    it('returns 401 when HMAC signature is invalid', async () => {
      setupSuccessfulAuth()
      mockValidateToken.mockReturnValue(false)

      const payload = createValidPayload()
      const body = JSON.stringify(payload)
      const token = generateToken(body, 'wrong-secret')

      const request = new Request('http://localhost:3000/api/v1/aggregate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-NextLib-Token': token,
          'X-NextLib-Secret-Hash': MOCK_TOKEN_HASH,
        },
        body,
      })

      const response = await POST(request)
      const responseBody = await response.json()

      expect(response.status).toBe(401)
      expect(responseBody.code).toBe('INVALID_SIGNATURE')
    })
  })

  describe('Payload Validation', () => {
    it('returns 400 for invalid JSON body', async () => {
      setupSuccessfulAuth()

      const request = new Request('http://localhost:3000/api/v1/aggregate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-NextLib-Token': '1234567890.abcdef',
          'X-NextLib-Secret-Hash': MOCK_TOKEN_HASH,
        },
        body: 'not valid json{{{',
      })

      const response = await POST(request)
      const responseBody = await response.json()

      expect(response.status).toBe(400)
      expect(responseBody.code).toBe('INVALID_JSON')
    })

    it('returns 400 when tenant_id is missing', async () => {
      setupSuccessfulAuth()

      const payload = { date: '2026-06-12', stats: { visitor_count: 1, loan_count: 1, return_count: 1 } }
      const body = JSON.stringify(payload)
      const token = generateToken(body, MOCK_API_SECRET)

      const request = new Request('http://localhost:3000/api/v1/aggregate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-NextLib-Token': token,
          'X-NextLib-Secret-Hash': MOCK_TOKEN_HASH,
        },
        body,
      })

      const response = await POST(request)
      const responseBody = await response.json()

      expect(response.status).toBe(400)
      expect(responseBody.code).toBe('VALIDATION_ERROR')
    })

    it('returns 400 when date format is invalid', async () => {
      setupSuccessfulAuth()

      const payload = createValidPayload({ date: '12-06-2026' })
      const body = JSON.stringify(payload)
      const token = generateToken(body, MOCK_API_SECRET)

      const request = new Request('http://localhost:3000/api/v1/aggregate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-NextLib-Token': token,
          'X-NextLib-Secret-Hash': MOCK_TOKEN_HASH,
        },
        body,
      })

      const response = await POST(request)
      const responseBody = await response.json()

      expect(response.status).toBe(400)
      expect(responseBody.code).toBe('VALIDATION_ERROR')
    })

    it('returns 400 when stats has negative values', async () => {
      setupSuccessfulAuth()

      const payload = createValidPayload({
        stats: { visitor_count: -1, loan_count: 0, return_count: 0 },
      })
      const body = JSON.stringify(payload)
      const token = generateToken(body, MOCK_API_SECRET)

      const request = new Request('http://localhost:3000/api/v1/aggregate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-NextLib-Token': token,
          'X-NextLib-Secret-Hash': MOCK_TOKEN_HASH,
        },
        body,
      })

      const response = await POST(request)
      const responseBody = await response.json()

      expect(response.status).toBe(400)
      expect(responseBody.code).toBe('VALIDATION_ERROR')
    })

    it('returns 400 when tenant_id does not match authenticated tenant', async () => {
      setupSuccessfulAuth()

      const differentTenantId = '999e4567-e89b-12d3-a456-426614174999'
      const payload = createValidPayload({ tenant_id: differentTenantId })
      const body = JSON.stringify(payload)
      const token = generateToken(body, MOCK_API_SECRET)

      const request = new Request('http://localhost:3000/api/v1/aggregate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-NextLib-Token': token,
          'X-NextLib-Secret-Hash': MOCK_TOKEN_HASH,
        },
        body,
      })

      const response = await POST(request)
      const responseBody = await response.json()

      expect(response.status).toBe(400)
      expect(responseBody.code).toBe('TENANT_MISMATCH')
    })
  })

  describe('Gzip Decompression', () => {
    it('decompresses gzip-encoded body correctly', async () => {
      setupSuccessfulAuth()

      const payload = createValidPayload()
      const body = JSON.stringify(payload)
      const compressed = gzipSync(Buffer.from(body, 'utf-8'))
      const token = generateToken(body, MOCK_API_SECRET)

      const request = new Request('http://localhost:3000/api/v1/aggregate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Encoding': 'gzip',
          'X-NextLib-Token': token,
          'X-NextLib-Secret-Hash': MOCK_TOKEN_HASH,
        },
        body: compressed,
      })

      const response = await POST(request)
      const responseBody = await response.json()

      expect(response.status).toBe(200)
      expect(responseBody.status).toBe('ok')
    })

    it('returns 400 for invalid gzip data', async () => {
      setupSuccessfulAuth()

      const request = new Request('http://localhost:3000/api/v1/aggregate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Encoding': 'gzip',
          'X-NextLib-Token': '1234567890.abcdef',
          'X-NextLib-Secret-Hash': MOCK_TOKEN_HASH,
        },
        body: Buffer.from('not-valid-gzip-data'),
      })

      const response = await POST(request)
      const responseBody = await response.json()

      expect(response.status).toBe(400)
      expect(responseBody.code).toBe('DECOMPRESSION_ERROR')
    })
  })

  describe('Successful Processing', () => {
    it('returns 200 with status ok when payload is valid (uncompressed)', async () => {
      setupSuccessfulAuth()

      const payload = createValidPayload()
      const body = JSON.stringify(payload)
      const token = generateToken(body, MOCK_API_SECRET)

      const request = new Request('http://localhost:3000/api/v1/aggregate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-NextLib-Token': token,
          'X-NextLib-Secret-Hash': MOCK_TOKEN_HASH,
        },
        body,
      })

      const response = await POST(request)
      const responseBody = await response.json()

      expect(response.status).toBe(200)
      expect(responseBody).toEqual({ status: 'ok' })
    })

    it('calls insertDailyStat with correct parameters', async () => {
      setupSuccessfulAuth()

      const payload = createValidPayload()
      const body = JSON.stringify(payload)
      const token = generateToken(body, MOCK_API_SECRET)

      const request = new Request('http://localhost:3000/api/v1/aggregate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-NextLib-Token': token,
          'X-NextLib-Secret-Hash': MOCK_TOKEN_HASH,
        },
        body,
      })

      await POST(request)

      expect(mockInsertDailyStat).toHaveBeenCalledWith({
        date: '2026-06-12',
        visitorCount: 150,
        loanCount: 45,
        returnCount: 38,
      })
    })

    it('returns 200 when gzip body is valid', async () => {
      setupSuccessfulAuth()

      const payload = createValidPayload()
      const body = JSON.stringify(payload)
      const compressed = gzipSync(Buffer.from(body, 'utf-8'))
      const token = generateToken(body, MOCK_API_SECRET)

      const request = new Request('http://localhost:3000/api/v1/aggregate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Encoding': 'gzip',
          'X-NextLib-Token': token,
          'X-NextLib-Secret-Hash': MOCK_TOKEN_HASH,
        },
        body: compressed,
      })

      const response = await POST(request)
      const responseBody = await response.json()

      expect(response.status).toBe(200)
      expect(responseBody.status).toBe('ok')
      expect(mockInsertDailyStat).toHaveBeenCalledWith({
        date: '2026-06-12',
        visitorCount: 150,
        loanCount: 45,
        returnCount: 38,
      })
    })
  })

  describe('Database Errors', () => {
    it('returns 409 for duplicate entry (same tenant+date)', async () => {
      setupSuccessfulAuth()

      const duplicateError = new Error('Unique constraint violation') as Error & { code: string }
      duplicateError.code = '23505'
      mockInsertDailyStat.mockRejectedValueOnce(duplicateError)

      const payload = createValidPayload()
      const body = JSON.stringify(payload)
      const token = generateToken(body, MOCK_API_SECRET)

      const request = new Request('http://localhost:3000/api/v1/aggregate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-NextLib-Token': token,
          'X-NextLib-Secret-Hash': MOCK_TOKEN_HASH,
        },
        body,
      })

      const response = await POST(request)
      const responseBody = await response.json()

      expect(response.status).toBe(409)
      expect(responseBody.code).toBe('DUPLICATE_ENTRY')
    })

    it('returns 500 for unexpected database errors', async () => {
      setupSuccessfulAuth()

      mockInsertDailyStat.mockRejectedValueOnce(new Error('Connection lost'))

      const payload = createValidPayload()
      const body = JSON.stringify(payload)
      const token = generateToken(body, MOCK_API_SECRET)

      const request = new Request('http://localhost:3000/api/v1/aggregate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-NextLib-Token': token,
          'X-NextLib-Secret-Hash': MOCK_TOKEN_HASH,
        },
        body,
      })

      const response = await POST(request)
      const responseBody = await response.json()

      expect(response.status).toBe(500)
      expect(responseBody.code).toBe('SERVER_ERROR')
    })
  })
})
