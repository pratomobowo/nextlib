import { describe, it, expect, vi, beforeEach } from 'vitest'
import { POST } from './route'

// Mock tenant data
const mockTenant = {
  id: '123e4567-e89b-12d3-a456-426614174000',
  name: 'Universitas Test',
  slug: 'universitas-test',
  slimsBaseUrl: 'encrypted-url',
  apiSecretEncrypted: 'encrypted-secret',
  tokenHash: 'abc123hash',
  status: 'pending',
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
}

// Mock db module
const mockUpdate = vi.fn().mockReturnValue({
  set: vi.fn().mockReturnValue({
    where: vi.fn().mockResolvedValue(undefined),
  }),
})

vi.mock('@/lib/db', () => ({
  db: {
    update: (...args: unknown[]) => mockUpdate(...args),
  },
}))

vi.mock('@/lib/db/schema', () => ({
  tenants: { id: 'id' },
}))

// Mock authenticateAgent
const mockAuthenticateAgent = vi.fn()
vi.mock('@/middleware/tenant-guard', () => ({
  authenticateAgent: (...args: unknown[]) => mockAuthenticateAgent(...args),
}))

describe('POST /api/v1/handshake', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  function createRequest(body: unknown, headers: Record<string, string> = {}) {
    return new Request('http://localhost:3000/api/v1/handshake', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      body: JSON.stringify(body),
    })
  }

  it('returns 200 with tenant name on valid handshake', async () => {
    mockAuthenticateAgent.mockResolvedValue({
      success: true,
      context: {
        tenant: mockTenant,
        scope: { tenantId: mockTenant.id },
      },
    })

    const request = createRequest(
      { action: 'ping' },
      {
        'x-nextlib-token': '1234567890.signature',
        'x-nextlib-secret-hash': 'abc123hash',
      }
    )

    const response = await POST(request)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.status).toBe('ok')
    expect(body.tenant_name).toBe('Universitas Test')
  })

  it('updates tenant status to connected', async () => {
    mockAuthenticateAgent.mockResolvedValue({
      success: true,
      context: {
        tenant: mockTenant,
        scope: { tenantId: mockTenant.id },
      },
    })

    const request = createRequest(
      { action: 'ping' },
      {
        'x-nextlib-token': '1234567890.signature',
        'x-nextlib-secret-hash': 'abc123hash',
      }
    )

    await POST(request)

    expect(mockUpdate).toHaveBeenCalled()
  })

  it('returns 401 when authentication fails (missing token)', async () => {
    const errorResponse = new Response(
      JSON.stringify({
        error: true,
        code: 'MISSING_TOKEN',
        message: 'X-NextLib-Token header is required',
      }),
      { status: 401 }
    )

    mockAuthenticateAgent.mockResolvedValue({
      success: false,
      response: errorResponse,
    })

    const request = createRequest({ action: 'ping' })
    const response = await POST(request)
    const body = await response.json()

    expect(response.status).toBe(401)
    expect(body.error).toBe(true)
    expect(body.code).toBe('MISSING_TOKEN')
  })

  it('returns 401 when authentication fails (invalid token)', async () => {
    const errorResponse = new Response(
      JSON.stringify({
        error: true,
        code: 'INVALID_TOKEN',
        message: 'Token format is invalid',
      }),
      { status: 401 }
    )

    mockAuthenticateAgent.mockResolvedValue({
      success: false,
      response: errorResponse,
    })

    const request = createRequest(
      { action: 'ping' },
      { 'x-nextlib-token': 'invalid-token' }
    )

    const response = await POST(request)
    const body = await response.json()

    expect(response.status).toBe(401)
    expect(body.error).toBe(true)
    expect(body.code).toBe('INVALID_TOKEN')
  })

  it('returns 400 when body is missing action field', async () => {
    mockAuthenticateAgent.mockResolvedValue({
      success: true,
      context: {
        tenant: mockTenant,
        scope: { tenantId: mockTenant.id },
      },
    })

    const request = createRequest(
      { foo: 'bar' },
      {
        'x-nextlib-token': '1234567890.signature',
        'x-nextlib-secret-hash': 'abc123hash',
      }
    )

    const response = await POST(request)
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error).toBe(true)
    expect(body.code).toBe('INVALID_ACTION')
  })

  it('returns 400 when action is not "ping"', async () => {
    mockAuthenticateAgent.mockResolvedValue({
      success: true,
      context: {
        tenant: mockTenant,
        scope: { tenantId: mockTenant.id },
      },
    })

    const request = createRequest(
      { action: 'pong' },
      {
        'x-nextlib-token': '1234567890.signature',
        'x-nextlib-secret-hash': 'abc123hash',
      }
    )

    const response = await POST(request)
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error).toBe(true)
    expect(body.code).toBe('INVALID_ACTION')
  })

  it('returns 400 when body is not valid JSON', async () => {
    mockAuthenticateAgent.mockResolvedValue({
      success: true,
      context: {
        tenant: mockTenant,
        scope: { tenantId: mockTenant.id },
      },
    })

    const request = new Request('http://localhost:3000/api/v1/handshake', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-nextlib-token': '1234567890.signature',
        'x-nextlib-secret-hash': 'abc123hash',
      },
      body: 'invalid json{{{',
    })

    const response = await POST(request)
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error).toBe(true)
    expect(body.code).toBe('INVALID_BODY')
  })

  it('returns 500 when database update fails', async () => {
    mockAuthenticateAgent.mockResolvedValue({
      success: true,
      context: {
        tenant: mockTenant,
        scope: { tenantId: mockTenant.id },
      },
    })

    mockUpdate.mockReturnValue({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockRejectedValue(new Error('DB connection failed')),
      }),
    })

    const request = createRequest(
      { action: 'ping' },
      {
        'x-nextlib-token': '1234567890.signature',
        'x-nextlib-secret-hash': 'abc123hash',
      }
    )

    const response = await POST(request)
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body.error).toBe(true)
    expect(body.code).toBe('SERVER_ERROR')
  })
})
