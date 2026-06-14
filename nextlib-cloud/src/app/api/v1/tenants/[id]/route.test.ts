import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GET } from './route'

const mockTenantId = '123e4567-e89b-12d3-a456-426614174000'
const otherTenantId = '999e4567-e89b-12d3-a456-426614174999'

const mockTenantRecord = {
  id: mockTenantId,
  name: 'Universitas Test',
  slug: 'universitas-test',
  slimsBaseUrl: 'encrypted-base-url',
  apiSecretEncrypted: 'encrypted-secret',
  tokenHash: 'abcdef1234567890',
  status: 'connected',
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-02'),
}

// Mock the database module
const mockLimit = vi.fn()
const mockWhere = vi.fn().mockReturnValue({ limit: mockLimit })
const mockFrom = vi.fn().mockReturnValue({ where: mockWhere })
const mockSelect = vi.fn().mockReturnValue({ from: mockFrom })

vi.mock('@/lib/db', () => ({
  db: {
    select: (...args: unknown[]) => mockSelect(...args),
  },
}))

// Mock the crypto module
const mockDecrypt = vi.fn().mockReturnValue('https://perpus.univ-test.ac.id/slims')
vi.mock('@/lib/crypto', () => ({
  decrypt: (...args: unknown[]) => mockDecrypt(...args),
}))

// Mock the tenant-guard middleware
const mockAuthenticateSession = vi.fn()
vi.mock('@/middleware/tenant-guard', () => ({
  authenticateSession: (...args: unknown[]) => mockAuthenticateSession(...args),
}))

// Mock environment variable
vi.stubEnv('AES_256_ENCRYPTION_KEY', 'a'.repeat(64))

function createRequest(tenantIdHeader?: string): Request {
  const headers: Record<string, string> = {}
  if (tenantIdHeader) {
    headers['x-tenant-id'] = tenantIdHeader
  }
  return new Request(`http://localhost:3000/api/v1/tenants/${mockTenantId}`, {
    method: 'GET',
    headers,
  })
}

function mockAuthSuccess(tenantId: string = mockTenantId) {
  mockAuthenticateSession.mockResolvedValue({
    success: true,
    context: {
      tenant: { ...mockTenantRecord, id: tenantId },
      scope: { tenantId, tenantFilter: vi.fn(), getDailyStats: vi.fn(), getDailyStatsByDate: vi.fn(), insertDailyStat: vi.fn() },
    },
  })
}

describe('GET /api/v1/tenants/:id', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('AES_256_ENCRYPTION_KEY', 'a'.repeat(64))
    // Default: db returns the mock tenant record
    mockLimit.mockResolvedValue([mockTenantRecord])
  })

  it('returns tenant details with decrypted slims_base_url for authorized request', async () => {
    mockAuthSuccess()

    const request = createRequest(mockTenantId)
    const response = await GET(request, { params: Promise.resolve({ id: mockTenantId }) })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.id).toBe(mockTenantId)
    expect(body.name).toBe('Universitas Test')
    expect(body.slug).toBe('universitas-test')
    expect(body.slims_base_url).toBe('https://perpus.univ-test.ac.id/slims')
    expect(body.status).toBe('connected')
    expect(body.created_at).toBeDefined()
    expect(body.updated_at).toBeDefined()
    // Sensitive fields should NOT be present
    expect(body.api_secret_encrypted).toBeUndefined()
    expect(body.token_hash).toBeUndefined()
  })

  it('returns 401 when not authenticated', async () => {
    const { NextResponse } = await import('next/server')
    mockAuthenticateSession.mockResolvedValue({
      success: false,
      response: NextResponse.json(
        { error: true, code: 'UNAUTHORIZED', message: 'Authentication required. Please log in.' },
        { status: 401 }
      ),
    })

    const request = createRequest()
    const response = await GET(request, { params: Promise.resolve({ id: mockTenantId }) })
    const body = await response.json()

    expect(response.status).toBe(401)
    expect(body.error).toBe(true)
    expect(body.code).toBe('UNAUTHORIZED')
  })

  it('returns 403 when tenant tries to access another tenant data', async () => {
    // Authenticated as mockTenantId, but requesting otherTenantId
    mockAuthSuccess(mockTenantId)

    const request = createRequest(mockTenantId)
    const response = await GET(request, { params: Promise.resolve({ id: otherTenantId }) })
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body.error).toBe(true)
    expect(body.code).toBe('FORBIDDEN')
  })

  it('returns 404 when tenant not found in database', async () => {
    mockAuthSuccess()
    // Override db to return empty results
    mockLimit.mockResolvedValue([])

    const request = createRequest(mockTenantId)
    const response = await GET(request, { params: Promise.resolve({ id: mockTenantId }) })
    const body = await response.json()

    expect(response.status).toBe(404)
    expect(body.error).toBe(true)
    expect(body.code).toBe('NOT_FOUND')
  })

  it('returns 500 when encryption key is not configured', async () => {
    vi.stubEnv('AES_256_ENCRYPTION_KEY', '')
    mockAuthSuccess()

    const request = createRequest(mockTenantId)
    const response = await GET(request, { params: Promise.resolve({ id: mockTenantId }) })
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body.error).toBe(true)
    expect(body.code).toBe('SERVER_ERROR')
  })

  it('never exposes api_secret_encrypted or token_hash in response', async () => {
    mockAuthSuccess()

    const request = createRequest(mockTenantId)
    const response = await GET(request, { params: Promise.resolve({ id: mockTenantId }) })
    const body = await response.json()

    expect(response.status).toBe(200)
    // Verify no sensitive fields leaked
    const responseKeys = Object.keys(body)
    expect(responseKeys).not.toContain('api_secret_encrypted')
    expect(responseKeys).not.toContain('apiSecretEncrypted')
    expect(responseKeys).not.toContain('token_hash')
    expect(responseKeys).not.toContain('tokenHash')
    expect(responseKeys).not.toContain('slimsBaseUrl') // Only decrypted slims_base_url
  })
})
