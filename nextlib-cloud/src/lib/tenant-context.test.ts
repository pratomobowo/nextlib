import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getTenantFromToken, getTenantFromSession, withTenantScope } from './tenant-context'

// vi.mock factories are hoisted above imports, so any value they reference
// must be defined via vi.hoisted (also hoisted) — module-level `const`s are not.
const { mockTenant } = vi.hoisted(() => ({
  mockTenant: {
    id: '123e4567-e89b-12d3-a456-426614174000',
    name: 'Universitas Test',
    slug: 'universitas-test',
    slimsBaseUrl: 'https://perpus.univ-test.ac.id/slims',
    apiSecretEncrypted: 'encrypted-secret',
    tokenHash: 'abc123hash',
    status: 'connected',
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  },
}))

// --- DB mock -------------------------------------------------------------
// Two select() shapes are needed:
//   1. token-hash lookup:  select().from(tenants).where(...).limit(1)
//   2. session→user→tenant: select({tenantId}).from(sessions).join(users)...
// The mock returns mockTenant for the tenants lookup and a fixed
// { tenantId: mockTenant.id } for the sessions lookup.
vi.mock('@/lib/db', () => {
  const tenantsLimit = vi.fn().mockResolvedValue([mockTenant])
  const tenantsWhere = vi.fn().mockReturnValue({ limit: () => tenantsLimit() })
  const tenantsFrom = vi.fn().mockReturnValue({ where: tenantsWhere })

  const sessionsLimit = vi.fn().mockResolvedValue([{ tenantId: mockTenant.id }])
  const sessionsWhere = vi.fn().mockReturnValue({ limit: () => sessionsLimit() })
  const sessionsJoin = vi.fn().mockReturnValue({ where: sessionsWhere })
  const sessionsFrom = vi.fn().mockReturnValue({ innerJoin: sessionsJoin })

  // Track which "shape" of select is being requested. The session lookup
  // passes a fields object; the tenant lookup passes none (selects all).
  const select = vi.fn((fields?: unknown) =>
    fields ? { from: sessionsFrom } : { from: tenantsFrom }
  )

  return {
    db: {
      select,
      insert: () => ({ values: () => ({ returning: () => Promise.resolve([{ id: 'new-id' }]) }) }),
    },
  }
})

describe('getTenantFromToken', () => {
  it('returns null for empty token hash', async () => {
    const result = await getTenantFromToken('')
    expect(result).toBeNull()
  })

  it('looks up tenant by token hash', async () => {
    const result = await getTenantFromToken('abc123hash')
    expect(result).toBeDefined()
    expect(result?.id).toBe(mockTenant.id)
  })
})

describe('getTenantFromSession', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns null when no session cookie is present', async () => {
    const request = new Request('http://localhost:3000/api/v1/data', {
      method: 'GET',
    })

    const result = await getTenantFromSession(request)
    expect(result).toBeNull()
  })

  it('resolves the tenant from a valid session cookie', async () => {
    const request = new Request('http://localhost:3000/api/v1/data', {
      method: 'GET',
      headers: {
        cookie: `nextlib_session=valid-session-token`,
      },
    })

    const result = await getTenantFromSession(request)
    expect(result).toBeDefined()
    expect(result?.id).toBe(mockTenant.id)
  })

  it('ignores the legacy X-Tenant-ID header (cookie-only auth)', async () => {
    // The header must NOT grant access — only the session cookie does.
    const request = new Request('http://localhost:3000/api/v1/data', {
      method: 'GET',
      headers: {
        'x-tenant-id': '123e4567-e89b-12d3-a456-426614174000',
      },
    })

    const result = await getTenantFromSession(request)
    expect(result).toBeNull()
  })
})

describe('withTenantScope', () => {
  it('returns a scope bound to the given tenant ID', () => {
    const scope = withTenantScope('tenant-123')
    expect(scope.tenantId).toBe('tenant-123')
  })

  it('different tenant IDs produce different scopes', () => {
    const scopeA = withTenantScope('tenant-a')
    const scopeB = withTenantScope('tenant-b')

    expect(scopeA.tenantId).toBe('tenant-a')
    expect(scopeB.tenantId).toBe('tenant-b')
    expect(scopeA.tenantId).not.toBe(scopeB.tenantId)
  })

  it('provides a tenantFilter method', () => {
    const scope = withTenantScope('tenant-123')
    // tenantFilter returns a Drizzle condition — verify it exists and is callable
    expect(typeof scope.tenantFilter).toBe('function')
    const filter = scope.tenantFilter()
    expect(filter).toBeDefined()
  })

  it('provides getDailyStats method', () => {
    const scope = withTenantScope('tenant-123')
    expect(typeof scope.getDailyStats).toBe('function')
  })

  it('provides getDailyStatsByDate method', () => {
    const scope = withTenantScope('tenant-123')
    expect(typeof scope.getDailyStatsByDate).toBe('function')
  })

  it('provides insertDailyStat method', () => {
    const scope = withTenantScope('tenant-123')
    expect(typeof scope.insertDailyStat).toBe('function')
  })
})
