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
const mockInsertDailyStatV2 = vi.fn().mockResolvedValue([{ id: 'stat-2' }])

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

function createValidPayloadV2(overrides = {}) {
  return {
    schema_version: '2.0',
    tenant_id: MOCK_TENANT_ID,
    date: '2026-06-12',
    daily_metrics: {
      visitor_count: 150,
      unique_visitor_count: 120,
      loan_count: 45,
      return_count: 38,
      new_member_count: 10,
      new_biblio_count: 5,
      new_item_count: 15,
      fines_debet_total: 50000,
      fines_credit_total: 20000,
      reservation_count: 3,
    },
    snapshot_metrics: {
      total_collection_size: 25000,
      active_member_count: 1500,
      active_overdue_count: 12,
    },
    anomaly_flags: ['ANOMALY_VISITORS'],
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
        status: 'connected',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      scope: {
        tenantId: MOCK_TENANT_ID,
        tenantFilter: vi.fn(),
        getDailyStats: vi.fn(),
        getDailyStatsByDate: vi.fn(),
        getDailyStatsV2: vi.fn(),
        getDailyStatsV2ByDate: vi.fn(),
        insertDailyStatV2: mockInsertDailyStatV2,
      },
    },
  })
}

describe('POST /api/v2/aggregate', () => {
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

      const payload = createValidPayloadV2()
      const body = JSON.stringify(payload)
      const request = new Request('http://localhost:3000/api/v2/aggregate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      })

      const response = await POST(request)
      const responseBody = await response.json()

      expect(response.status).toBe(401)
      expect(responseBody.code).toBe('MISSING_TOKEN')
    })

    it('returns 401 when HMAC signature is invalid', async () => {
      setupSuccessfulAuth()
      mockValidateToken.mockReturnValue(false)

      const payload = createValidPayloadV2()
      const body = JSON.stringify(payload)
      const token = generateToken(body, 'wrong-secret')

      const request = new Request('http://localhost:3000/api/v2/aggregate', {
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

      const request = new Request('http://localhost:3000/api/v2/aggregate', {
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

    it('returns 400 when schema_version is not 2.0', async () => {
      setupSuccessfulAuth()

      const payload = createValidPayloadV2({ schema_version: '1.0' })
      const body = JSON.stringify(payload)
      const token = generateToken(body, MOCK_API_SECRET)

      const request = new Request('http://localhost:3000/api/v2/aggregate', {
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
      const payload = createValidPayloadV2({ tenant_id: differentTenantId })
      const body = JSON.stringify(payload)
      const token = generateToken(body, MOCK_API_SECRET)

      const request = new Request('http://localhost:3000/api/v2/aggregate', {
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

    it('returns 400 when metrics contain negative values', async () => {
      setupSuccessfulAuth()

      const payload = createValidPayloadV2({
        daily_metrics: {
          visitor_count: -1,
          unique_visitor_count: 0,
          loan_count: 0,
          return_count: 0,
          new_member_count: 0,
          new_biblio_count: 0,
          new_item_count: 0,
          fines_debet_total: 0,
          fines_credit_total: 0,
          reservation_count: 0,
        }
      })
      const body = JSON.stringify(payload)
      const token = generateToken(body, MOCK_API_SECRET)

      const request = new Request('http://localhost:3000/api/v2/aggregate', {
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
  })

  describe('Successful Processing', () => {
    it('returns 200 with status ok and stores the v2 metrics', async () => {
      setupSuccessfulAuth()

      const payload = createValidPayloadV2()
      const body = JSON.stringify(payload)
      const token = generateToken(body, MOCK_API_SECRET)

      const request = new Request('http://localhost:3000/api/v2/aggregate', {
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
      expect(mockInsertDailyStatV2).toHaveBeenCalledWith({
        date: '2026-06-12',
        visitorCount: 150,
        uniqueVisitorCount: 120,
        loanCount: 45,
        returnCount: 38,
        newMemberCount: 10,
        newBiblioCount: 5,
        newItemCount: 15,
        finesDebetTotal: 50000,
        finesCreditTotal: 20000,
        reservationCount: 3,
        totalCollectionSize: 25000,
        activeMemberCount: 1500,
        activeOverdueCount: 12,
        anomalyFlags: ['ANOMALY_VISITORS'],
      })
    })

    it('decompresses gzip-encoded v2 body correctly', async () => {
      setupSuccessfulAuth()

      const payload = createValidPayloadV2()
      const body = JSON.stringify(payload)
      const compressed = gzipSync(Buffer.from(body, 'utf-8'))
      const token = generateToken(body, MOCK_API_SECRET)

      const request = new Request('http://localhost:3000/api/v2/aggregate', {
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
  })
})
