import { describe, it, expect, vi, beforeEach } from 'vitest'
import { authenticateAgent, authenticateSession, authenticateRequest } from './tenant-guard'

const mockTenant = {
  id: '123e4567-e89b-12d3-a456-426614174000',
  name: 'Universitas Test',
  slug: 'universitas-test',
  slimsBaseUrl: 'https://perpus.univ-test.ac.id/slims',
  apiSecretEncrypted: 'encrypted-secret',
  tokenHash: 'abc123hash',
  ed25519PublicKey: null,
  ed25519PrivateKeyEncrypted: null,
  ed25519RotatedAt: null,
  ed25519KeyId: null,
  status: 'connected',
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
}

// Mock the tenant context module
vi.mock('@/lib/tenant-context', () => ({
  getTenantFromToken: vi.fn(),
  getTenantFromSession: vi.fn(),
  withTenantScope: vi.fn((tenantId: string) => ({
    tenantId,
    tenantFilter: vi.fn(),
    getDailyStats: vi.fn(),
    getDailyStatsByDate: vi.fn(),
    insertDailyStat: vi.fn(),
  })),
}))

// Mock HMAC utilities
vi.mock('@/lib/hmac', () => ({
  validateToken: vi.fn(),
  isTokenExpired: vi.fn(),
}))

import { getTenantFromToken, getTenantFromSession } from '@/lib/tenant-context'
import { isTokenExpired } from '@/lib/hmac'

describe('authenticateAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when X-NextLib-Token header is missing', async () => {
    const request = new Request('http://localhost:3000/api/v1/aggregate', {
      method: 'POST',
    })

    const result = await authenticateAgent(request)

    expect(result.success).toBe(false)
    if (!result.success) {
      const body = await result.response.json()
      expect(result.response.status).toBe(401)
      expect(body.code).toBe('MISSING_TOKEN')
    }
  })

  it('returns 401 when token format is invalid', async () => {
    const request = new Request('http://localhost:3000/api/v1/aggregate', {
      method: 'POST',
      headers: {
        'x-nextlib-token': 'invalid-token-no-dot',
        'x-nextlib-secret-hash': 'abc123hash',
      },
    })

    const result = await authenticateAgent(request)

    expect(result.success).toBe(false)
    if (!result.success) {
      const body = await result.response.json()
      expect(result.response.status).toBe(401)
      expect(body.code).toBe('INVALID_TOKEN')
    }
  })

  it('returns 401 when token is expired', async () => {
    vi.mocked(isTokenExpired).mockReturnValue(true)

    const request = new Request('http://localhost:3000/api/v1/aggregate', {
      method: 'POST',
      headers: {
        'x-nextlib-token': '1000000000.validsignature',
        'x-nextlib-secret-hash': 'abc123hash',
      },
    })

    const result = await authenticateAgent(request)

    expect(result.success).toBe(false)
    if (!result.success) {
      const body = await result.response.json()
      expect(result.response.status).toBe(401)
      expect(body.code).toBe('TOKEN_EXPIRED')
    }
  })

  it('returns 401 when X-NextLib-Secret-Hash header is missing', async () => {
    vi.mocked(isTokenExpired).mockReturnValue(false)

    const request = new Request('http://localhost:3000/api/v1/aggregate', {
      method: 'POST',
      headers: {
        'x-nextlib-token': '1700000000.validsignature',
      },
    })

    const result = await authenticateAgent(request)

    expect(result.success).toBe(false)
    if (!result.success) {
      const body = await result.response.json()
      expect(result.response.status).toBe(401)
      expect(body.code).toBe('MISSING_SECRET_HASH')
    }
  })

  it('returns 401 when tenant is not found by token hash', async () => {
    vi.mocked(isTokenExpired).mockReturnValue(false)
    vi.mocked(getTenantFromToken).mockResolvedValue(null)

    const request = new Request('http://localhost:3000/api/v1/aggregate', {
      method: 'POST',
      headers: {
        'x-nextlib-token': '1700000000.validsignature',
        'x-nextlib-secret-hash': 'unknown-hash',
      },
    })

    const result = await authenticateAgent(request)

    expect(result.success).toBe(false)
    if (!result.success) {
      const body = await result.response.json()
      expect(result.response.status).toBe(401)
      expect(body.code).toBe('TENANT_NOT_FOUND')
    }
  })

  it('returns success with tenant context when authentication passes', async () => {
    vi.mocked(isTokenExpired).mockReturnValue(false)
    vi.mocked(getTenantFromToken).mockResolvedValue(mockTenant)

    const request = new Request('http://localhost:3000/api/v1/aggregate', {
      method: 'POST',
      headers: {
        'x-nextlib-token': '1700000000.validsignature',
        'x-nextlib-secret-hash': 'abc123hash',
      },
    })

    const result = await authenticateAgent(request)

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.context.tenant.id).toBe(mockTenant.id)
      expect(result.context.tenant.name).toBe(mockTenant.name)
      expect(result.context.scope.tenantId).toBe(mockTenant.id)
    }
  })
})

describe('authenticateSession', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when no session/tenant found', async () => {
    vi.mocked(getTenantFromSession).mockResolvedValue(null)

    const request = new Request('http://localhost:3000/api/v1/tenants/123', {
      method: 'GET',
    })

    const result = await authenticateSession(request)

    expect(result.success).toBe(false)
    if (!result.success) {
      const body = await result.response.json()
      expect(result.response.status).toBe(401)
      expect(body.code).toBe('UNAUTHORIZED')
    }
  })

  it('returns success with tenant context when session is valid', async () => {
    vi.mocked(getTenantFromSession).mockResolvedValue(mockTenant)

    const request = new Request('http://localhost:3000/api/v1/tenants/123', {
      method: 'GET',
      headers: {
        'x-tenant-id': mockTenant.id,
      },
    })

    const result = await authenticateSession(request)

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.context.tenant.id).toBe(mockTenant.id)
      expect(result.context.scope.tenantId).toBe(mockTenant.id)
    }
  })
})

describe('authenticateRequest', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uses agent authentication when X-NextLib-Token is present', async () => {
    vi.mocked(isTokenExpired).mockReturnValue(false)
    vi.mocked(getTenantFromToken).mockResolvedValue(mockTenant)

    const request = new Request('http://localhost:3000/api/v1/aggregate', {
      method: 'POST',
      headers: {
        'x-nextlib-token': '1700000000.validsignature',
        'x-nextlib-secret-hash': 'abc123hash',
      },
    })

    const result = await authenticateRequest(request)

    expect(result.success).toBe(true)
    expect(getTenantFromToken).toHaveBeenCalledWith('abc123hash')
    expect(getTenantFromSession).not.toHaveBeenCalled()
  })

  it('falls back to session auth when no agent token present', async () => {
    vi.mocked(getTenantFromSession).mockResolvedValue(mockTenant)

    const request = new Request('http://localhost:3000/api/v1/tenants/123', {
      method: 'GET',
      headers: {
        'x-tenant-id': mockTenant.id,
      },
    })

    const result = await authenticateRequest(request)

    expect(result.success).toBe(true)
    expect(getTenantFromSession).toHaveBeenCalledWith(request)
    expect(getTenantFromToken).not.toHaveBeenCalled()
  })
})

describe('Tenant scope isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('scope is always bound to the authenticated tenant ID', async () => {
    vi.mocked(isTokenExpired).mockReturnValue(false)
    vi.mocked(getTenantFromToken).mockResolvedValue(mockTenant)

    const request = new Request('http://localhost:3000/api/v1/aggregate', {
      method: 'POST',
      headers: {
        'x-nextlib-token': '1700000000.validsignature',
        'x-nextlib-secret-hash': 'abc123hash',
      },
    })

    const result = await authenticateRequest(request)

    expect(result.success).toBe(true)
    if (result.success) {
      // Scope must be bound to the authenticated tenant's ID
      expect(result.context.scope.tenantId).toBe(mockTenant.id)
      // Scope should never use a different tenant's ID
      expect(result.context.scope.tenantId).not.toBe('different-tenant-id')
    }
  })

  it('different tenants get different scopes', async () => {
    const tenantA = { ...mockTenant, id: 'tenant-a-id' }
    const tenantB = { ...mockTenant, id: 'tenant-b-id' }

    vi.mocked(isTokenExpired).mockReturnValue(false)

    // Simulate request from tenant A
    vi.mocked(getTenantFromToken).mockResolvedValue(tenantA)
    const requestA = new Request('http://localhost:3000/api/v1/aggregate', {
      method: 'POST',
      headers: {
        'x-nextlib-token': '1700000000.signatureA',
        'x-nextlib-secret-hash': 'hashA',
      },
    })
    const resultA = await authenticateRequest(requestA)

    // Simulate request from tenant B
    vi.mocked(getTenantFromToken).mockResolvedValue(tenantB)
    const requestB = new Request('http://localhost:3000/api/v1/aggregate', {
      method: 'POST',
      headers: {
        'x-nextlib-token': '1700000000.signatureB',
        'x-nextlib-secret-hash': 'hashB',
      },
    })
    const resultB = await authenticateRequest(requestB)

    expect(resultA.success).toBe(true)
    expect(resultB.success).toBe(true)

    if (resultA.success && resultB.success) {
      expect(resultA.context.scope.tenantId).toBe('tenant-a-id')
      expect(resultB.context.scope.tenantId).toBe('tenant-b-id')
      expect(resultA.context.scope.tenantId).not.toBe(resultB.context.scope.tenantId)
    }
  })
})
