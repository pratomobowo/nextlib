import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createHash, createHmac } from 'crypto'

// ─── Mock Constants ────────────────────────────────────────────────────────────
const MOCK_TENANT_ID = '123e4567-e89b-12d3-a456-426614174000'
const MOCK_API_SECRET = 'a'.repeat(64)
const MOCK_TOKEN_HASH = createHash('sha256').update(MOCK_API_SECRET).digest('hex')
const MOCK_ENCRYPTION_KEY = 'b'.repeat(64)

// ─── Mock DB Layer ─────────────────────────────────────────────────────────────
const mockDbSelectResult: unknown[] = []
const mockDbInsertResult: unknown[] = []
const mockDbUpdateResult: unknown[] = []

const mockWhere = vi.fn().mockReturnThis()
const mockLimit = vi.fn().mockImplementation(() => mockDbSelectResult)
const mockReturning = vi.fn().mockImplementation(() => mockDbInsertResult)
const mockSet = vi.fn().mockReturnThis()

vi.mock('@/lib/db', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: mockWhere.mockReturnValue({
          limit: mockLimit,
        }),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: mockReturning,
      })),
    })),
    update: vi.fn(() => ({
      set: mockSet.mockReturnValue({
        where: mockWhere.mockResolvedValue(mockDbUpdateResult),
      }),
    })),
  },
}))

vi.mock('@/lib/db/schema', () => ({
  tenants: {
    id: 'id',
    name: 'name',
    slug: 'slug',
    slimsBaseUrl: 'slims_base_url',
    apiSecretEncrypted: 'api_secret_encrypted',
    tokenHash: 'token_hash',
    status: 'status',
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  },
  dailyStats: {},
}))

vi.mock('@/lib/crypto', () => ({
  encrypt: vi.fn((val: string) => `encrypted_${val}`),
  decrypt: vi.fn((val: string) => val.replace('encrypted_', '')),
}))

vi.mock('@/lib/tenant-context', () => ({
  getTenantFromToken: vi.fn(),
  getTenantFromSession: vi.fn(),
  withTenantScope: vi.fn(() => ({
    tenantId: MOCK_TENANT_ID,
    tenantFilter: vi.fn(),
    getDailyStats: vi.fn(),
    getDailyStatsByDate: vi.fn(),
    insertDailyStat: vi.fn(),
  })),
}))

vi.mock('@/lib/hmac', () => ({
  validateToken: vi.fn(),
  isTokenExpired: vi.fn(),
  generateToken: vi.fn(),
}))

vi.mock('@/middleware/tenant-guard', () => ({
  authenticateAgent: vi.fn(),
}))

// ─── Import Mocked Modules ────────────────────────────────────────────────────
import { authenticateAgent } from '@/middleware/tenant-guard'
import { getTenantFromToken } from '@/lib/tenant-context'
import { isTokenExpired } from '@/lib/hmac'

const mockAuthenticateAgent = vi.mocked(authenticateAgent)
const mockGetTenantFromToken = vi.mocked(getTenantFromToken)
const mockIsTokenExpired = vi.mocked(isTokenExpired)

// ─── Env Setup ─────────────────────────────────────────────────────────────────
vi.stubEnv('AES_256_ENCRYPTION_KEY', MOCK_ENCRYPTION_KEY)

// ─── Helper Functions ──────────────────────────────────────────────────────────
function generateValidToken(body: string, secret: string): string {
  const timestamp = Math.floor(Date.now() / 1000).toString()
  const signature = createHmac('sha256', secret)
    .update(timestamp + body)
    .digest('hex')
  return `${timestamp}.${signature}`
}

function createMockTenant(overrides = {}) {
  return {
    id: MOCK_TENANT_ID,
    name: 'Universitas Test',
    slug: 'universitas-test',
    slimsBaseUrl: 'encrypted_https://slims.test.ac.id',
    apiSecretEncrypted: `encrypted_${MOCK_API_SECRET}`,
    tokenHash: MOCK_TOKEN_HASH,
    ed25519PublicKey: null,
    ed25519PrivateKeyEncrypted: null,
    ed25519RotatedAt: null,
    ed25519KeyId: null,
    status: 'pending' as string,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

function setupSuccessfulAuth(tenantOverrides = {}) {
  const tenant = createMockTenant(tenantOverrides)
  mockAuthenticateAgent.mockResolvedValue({
    success: true,
    context: {
      tenant,
      scope: {
        tenantId: tenant.id,
        tenantFilter: vi.fn(),
        getDailyStats: vi.fn(),
        getDailyStatsByDate: vi.fn(),
        insertDailyStat: vi.fn(),
      },
    },
  })
  return tenant
}

function setupFailedAuth(code: string, message: string, status: number = 401) {
  mockAuthenticateAgent.mockResolvedValue({
    success: false,
    response: new Response(
      JSON.stringify({ error: true, code, message }),
      { status, headers: { 'Content-Type': 'application/json' } }
    ),
  })
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('Onboarding Flow Integration Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('AES_256_ENCRYPTION_KEY', MOCK_ENCRYPTION_KEY)
  })

  describe('1. Full Happy Path: Register → Token → Handshake → Connected', () => {
    it('completes the full onboarding flow successfully', async () => {
      // Step 1: Register tenant (POST /api/v1/tenants)
      // Mock db: no existing slug conflict
      mockLimit.mockResolvedValueOnce([]) // ensureUniqueSlug check

      const createdTenant = {
        id: MOCK_TENANT_ID,
        name: 'Universitas Nusantara',
        slug: 'universitas-nusantara',
        status: 'pending',
        createdAt: new Date(),
      }
      mockReturning.mockResolvedValueOnce([createdTenant])

      const { POST: registerTenant } = await import('../tenants/route')

      const registerRequest = new Request('http://localhost:3000/api/v1/tenants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Universitas Nusantara',
          slims_base_url: 'https://slims.nusantara.ac.id',
        }),
      })

      const registerResponse = await registerTenant(registerRequest)
      const registerBody = await registerResponse.json()

      // Verify registration response
      expect(registerResponse.status).toBe(201)
      expect(registerBody.id).toBe(MOCK_TENANT_ID)
      expect(registerBody.slug).toBe('universitas-nusantara')
      expect(registerBody.status).toBe('pending')
      expect(registerBody.api_token).toBeDefined()
      expect(typeof registerBody.api_token).toBe('string')
      expect(registerBody.api_token.length).toBe(64) // 32 bytes hex

      // Step 2: Agent uses the token to handshake
      setupSuccessfulAuth({ status: 'pending' })

      const { POST: handshake } = await import('../handshake/route')

      const handshakeBody = JSON.stringify({ action: 'ping' })
      const token = generateValidToken(handshakeBody, MOCK_API_SECRET)
      const secretHash = createHash('sha256').update(MOCK_API_SECRET).digest('hex')

      const handshakeRequest = new Request('http://localhost:3000/api/v1/handshake', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-NextLib-Token': token,
          'X-NextLib-Secret-Hash': secretHash,
        },
        body: handshakeBody,
      })

      const handshakeResponse = await handshake(handshakeRequest)
      const handshakeResponseBody = await handshakeResponse.json()

      // Verify handshake success → tenant becomes "connected"
      expect(handshakeResponse.status).toBe(200)
      expect(handshakeResponseBody.status).toBe('ok')
      expect(handshakeResponseBody.tenant_name).toBe('Universitas Test')
    })
  })

  describe('2. Register Returns Unique Token and Slug', () => {
    it('generates a unique API token (64 hex chars) and slug', async () => {
      mockLimit.mockResolvedValueOnce([]) // slug is unique

      const createdTenant = {
        id: MOCK_TENANT_ID,
        name: 'Universitas Alpha',
        slug: 'universitas-alpha',
        status: 'pending',
        createdAt: new Date(),
      }
      mockReturning.mockResolvedValueOnce([createdTenant])

      const { POST: registerTenant } = await import('../tenants/route')

      const request = new Request('http://localhost:3000/api/v1/tenants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Universitas Alpha',
          slims_base_url: 'https://slims.alpha.ac.id',
        }),
      })

      const response = await registerTenant(request)
      const body = await response.json()

      expect(response.status).toBe(201)
      expect(body.api_token).toMatch(/^[a-f0-9]{64}$/)
      expect(body.slug).toBe('universitas-alpha')
    })

    it('auto-generates unique slug from name when slug collides', async () => {
      // First slug check: conflict exists
      mockLimit.mockResolvedValueOnce([{ id: 'existing-id' }])
      // Second slug check with suffix: no conflict
      mockLimit.mockResolvedValueOnce([])

      const createdTenant = {
        id: MOCK_TENANT_ID,
        name: 'Universitas Alpha',
        slug: 'universitas-alpha-1',
        status: 'pending',
        createdAt: new Date(),
      }
      mockReturning.mockResolvedValueOnce([createdTenant])

      const { POST: registerTenant } = await import('../tenants/route')

      const request = new Request('http://localhost:3000/api/v1/tenants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Universitas Alpha',
          slims_base_url: 'https://slims.alpha2.ac.id',
        }),
      })

      const response = await registerTenant(request)
      const body = await response.json()

      expect(response.status).toBe(201)
      expect(body.slug).toBe('universitas-alpha-1')
    })
  })

  describe('3. Handshake with Valid Token Updates Status to "connected"', () => {
    it('updates tenant status from pending to connected on valid handshake', async () => {
      setupSuccessfulAuth({ status: 'pending' })

      const { POST: handshake } = await import('../handshake/route')

      const body = JSON.stringify({ action: 'ping' })
      const token = generateValidToken(body, MOCK_API_SECRET)

      const request = new Request('http://localhost:3000/api/v1/handshake', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-NextLib-Token': token,
          'X-NextLib-Secret-Hash': MOCK_TOKEN_HASH,
        },
        body,
      })

      const response = await handshake(request)
      const responseBody = await response.json()

      expect(response.status).toBe(200)
      expect(responseBody.status).toBe('ok')
      expect(responseBody.tenant_name).toBe('Universitas Test')
    })

    it('returns tenant_name in the handshake response', async () => {
      setupSuccessfulAuth({ name: 'Institut Teknologi Maju' })

      const { POST: handshake } = await import('../handshake/route')

      const body = JSON.stringify({ action: 'ping' })
      const token = generateValidToken(body, MOCK_API_SECRET)

      const request = new Request('http://localhost:3000/api/v1/handshake', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-NextLib-Token': token,
          'X-NextLib-Secret-Hash': MOCK_TOKEN_HASH,
        },
        body,
      })

      const response = await handshake(request)
      const responseBody = await response.json()

      expect(response.status).toBe(200)
      expect(responseBody.tenant_name).toBe('Institut Teknologi Maju')
    })
  })

  describe('4. Handshake with Invalid Token Returns 401', () => {
    it('returns 401 when token is missing', async () => {
      setupFailedAuth('MISSING_TOKEN', 'X-NextLib-Token header is required')

      const { POST: handshake } = await import('../handshake/route')

      const request = new Request('http://localhost:3000/api/v1/handshake', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'ping' }),
      })

      const response = await handshake(request)
      const responseBody = await response.json()

      expect(response.status).toBe(401)
      expect(responseBody.code).toBe('MISSING_TOKEN')
    })

    it('returns 401 when token format is invalid', async () => {
      setupFailedAuth('INVALID_TOKEN', 'Token format is invalid')

      const { POST: handshake } = await import('../handshake/route')

      const request = new Request('http://localhost:3000/api/v1/handshake', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-NextLib-Token': 'invalid-format-no-dot',
          'X-NextLib-Secret-Hash': MOCK_TOKEN_HASH,
        },
        body: JSON.stringify({ action: 'ping' }),
      })

      const response = await handshake(request)
      const responseBody = await response.json()

      expect(response.status).toBe(401)
      expect(responseBody.code).toBe('INVALID_TOKEN')
    })

    it('returns 401 when token is expired', async () => {
      setupFailedAuth('TOKEN_EXPIRED', 'Token has expired. Please generate a new token.')

      const { POST: handshake } = await import('../handshake/route')

      // Generate an expired token (timestamp 10 minutes ago)
      const expiredTimestamp = (Math.floor(Date.now() / 1000) - 600).toString()
      const body = JSON.stringify({ action: 'ping' })
      const signature = createHmac('sha256', MOCK_API_SECRET)
        .update(expiredTimestamp + body)
        .digest('hex')
      const expiredToken = `${expiredTimestamp}.${signature}`

      const request = new Request('http://localhost:3000/api/v1/handshake', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-NextLib-Token': expiredToken,
          'X-NextLib-Secret-Hash': MOCK_TOKEN_HASH,
        },
        body,
      })

      const response = await handshake(request)
      const responseBody = await response.json()

      expect(response.status).toBe(401)
      expect(responseBody.code).toBe('TOKEN_EXPIRED')
    })
  })

  describe('5. Handshake from Unrecognized Token Returns Error', () => {
    it('returns 401 when secret hash does not match any tenant', async () => {
      setupFailedAuth('TENANT_NOT_FOUND', 'No tenant found for the provided credentials')

      const { POST: handshake } = await import('../handshake/route')

      const unknownSecret = 'c'.repeat(64)
      const unknownHash = createHash('sha256').update(unknownSecret).digest('hex')
      const body = JSON.stringify({ action: 'ping' })
      const token = generateValidToken(body, unknownSecret)

      const request = new Request('http://localhost:3000/api/v1/handshake', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-NextLib-Token': token,
          'X-NextLib-Secret-Hash': unknownHash,
        },
        body,
      })

      const response = await handshake(request)
      const responseBody = await response.json()

      expect(response.status).toBe(401)
      expect(responseBody.code).toBe('TENANT_NOT_FOUND')
    })

    it('returns 401 when X-NextLib-Secret-Hash header is missing', async () => {
      setupFailedAuth('MISSING_SECRET_HASH', 'X-NextLib-Secret-Hash header is required for tenant identification')

      const { POST: handshake } = await import('../handshake/route')

      const body = JSON.stringify({ action: 'ping' })
      const token = generateValidToken(body, MOCK_API_SECRET)

      const request = new Request('http://localhost:3000/api/v1/handshake', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-NextLib-Token': token,
        },
        body,
      })

      const response = await handshake(request)
      const responseBody = await response.json()

      expect(response.status).toBe(401)
      expect(responseBody.code).toBe('MISSING_SECRET_HASH')
    })
  })

  describe('6. Connection Status Shows "Connected" After Successful Handshake', () => {
    it('handshake response confirms connected state with status "ok"', async () => {
      setupSuccessfulAuth({ status: 'pending' })

      const { POST: handshake } = await import('../handshake/route')

      const body = JSON.stringify({ action: 'ping' })
      const token = generateValidToken(body, MOCK_API_SECRET)

      const request = new Request('http://localhost:3000/api/v1/handshake', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-NextLib-Token': token,
          'X-NextLib-Secret-Hash': MOCK_TOKEN_HASH,
        },
        body,
      })

      const response = await handshake(request)
      const responseBody = await response.json()

      // Successful handshake means status transitions to "connected"
      expect(response.status).toBe(200)
      expect(responseBody.status).toBe('ok')
    })

    it('db update is called to set status to connected', async () => {
      const { db } = await import('@/lib/db')
      setupSuccessfulAuth({ status: 'pending' })

      const { POST: handshake } = await import('../handshake/route')

      const body = JSON.stringify({ action: 'ping' })
      const token = generateValidToken(body, MOCK_API_SECRET)

      const request = new Request('http://localhost:3000/api/v1/handshake', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-NextLib-Token': token,
          'X-NextLib-Secret-Hash': MOCK_TOKEN_HASH,
        },
        body,
      })

      await handshake(request)

      // Verify the db.update was called (status transition to "connected")
      expect(db.update).toHaveBeenCalled()
      expect(mockSet).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'connected' })
      )
    })
  })

  describe('7. Connection Status Shows "Disconnected" After Failed Handshake', () => {
    it('status remains pending/disconnected when handshake fails with invalid token', async () => {
      setupFailedAuth('INVALID_TOKEN', 'Token format is invalid')

      const { POST: handshake } = await import('../handshake/route')

      const request = new Request('http://localhost:3000/api/v1/handshake', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-NextLib-Token': 'invalid',
          'X-NextLib-Secret-Hash': MOCK_TOKEN_HASH,
        },
        body: JSON.stringify({ action: 'ping' }),
      })

      const response = await handshake(request)
      const responseBody = await response.json()

      expect(response.status).toBe(401)
      expect(responseBody.error).toBe(true)
      // Status was NOT updated to connected (db.update not called for status change)
      const { db } = await import('@/lib/db')
      expect(db.update).not.toHaveBeenCalled()
    })

    it('status remains disconnected when handshake fails with expired token', async () => {
      setupFailedAuth('TOKEN_EXPIRED', 'Token has expired. Please generate a new token.')

      const { POST: handshake } = await import('../handshake/route')

      const request = new Request('http://localhost:3000/api/v1/handshake', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-NextLib-Token': '1000000000.expired',
          'X-NextLib-Secret-Hash': MOCK_TOKEN_HASH,
        },
        body: JSON.stringify({ action: 'ping' }),
      })

      const response = await handshake(request)
      const responseBody = await response.json()

      expect(response.status).toBe(401)
      expect(responseBody.error).toBe(true)
      expect(responseBody.code).toBe('TOKEN_EXPIRED')
    })

    it('returns descriptive error message when handshake fails', async () => {
      setupFailedAuth('TENANT_NOT_FOUND', 'No tenant found for the provided credentials')

      const { POST: handshake } = await import('../handshake/route')

      const body = JSON.stringify({ action: 'ping' })
      const token = generateValidToken(body, 'x'.repeat(64))
      const unknownHash = createHash('sha256').update('x'.repeat(64)).digest('hex')

      const request = new Request('http://localhost:3000/api/v1/handshake', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-NextLib-Token': token,
          'X-NextLib-Secret-Hash': unknownHash,
        },
        body,
      })

      const response = await handshake(request)
      const responseBody = await response.json()

      expect(response.status).toBe(401)
      expect(responseBody.message).toBeDefined()
      expect(responseBody.message.length).toBeGreaterThan(0)
    })
  })

  describe('Handshake Body Validation', () => {
    it('returns 400 when body is not valid JSON', async () => {
      setupSuccessfulAuth()

      const { POST: handshake } = await import('../handshake/route')

      const request = new Request('http://localhost:3000/api/v1/handshake', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-NextLib-Token': '1234567890.abcdef',
          'X-NextLib-Secret-Hash': MOCK_TOKEN_HASH,
        },
        body: 'not valid json{{{',
      })

      const response = await handshake(request)
      const responseBody = await response.json()

      expect(response.status).toBe(400)
      expect(responseBody.code).toBe('INVALID_BODY')
    })

    it('returns 400 when action is not "ping"', async () => {
      setupSuccessfulAuth()

      const { POST: handshake } = await import('../handshake/route')

      const request = new Request('http://localhost:3000/api/v1/handshake', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-NextLib-Token': '1234567890.abcdef',
          'X-NextLib-Secret-Hash': MOCK_TOKEN_HASH,
        },
        body: JSON.stringify({ action: 'invalid' }),
      })

      const response = await handshake(request)
      const responseBody = await response.json()

      expect(response.status).toBe(400)
      expect(responseBody.code).toBe('INVALID_ACTION')
    })
  })
})
