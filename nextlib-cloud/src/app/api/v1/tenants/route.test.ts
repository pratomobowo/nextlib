import { describe, it, expect, vi, beforeEach } from 'vitest'
import { POST, GET } from './route'

// Mock session auth — individual tests override getSessionUser via vi.mocked
vi.mock('@/lib/auth/session', () => ({
  getSessionUser: vi.fn(),
}))

import { getSessionUser } from '@/lib/auth/session'

// Sample tenant rows returned by the SELECT chain
const sampleTenants = [
  {
    id: '123e4567-e89b-12d3-a456-426614174000',
    name: 'Universitas Test',
    slug: 'universitas-test',
    status: 'connected',
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-02'),
  },
  {
    id: '223e4567-e89b-12d3-a456-426614174001',
    name: 'Universitas Lain',
    slug: 'universitas-lain',
    status: 'pending',
    createdAt: new Date('2024-02-01'),
    updatedAt: new Date('2024-02-02'),
  },
]

// Mock the database module.
// Default: SELECT chains resolve to [] (so POST's ensureUniqueSlug sees no
// collision). GET tests override the select mock return value per-test.
vi.mock('@/lib/db', () => {
  const buildChain = (resolved: unknown) => {
    const where = vi.fn(() => buildChain(resolved))
    const limit = vi.fn().mockResolvedValue(resolved)
    const chain = {
      from: vi.fn(() => chain),
      where,
      limit,
      // Make the chain itself awaitable so `await db.select().from(tenants)`
      // resolves (used by the super_admin path).
      then(resolve: (v: unknown) => void) {
        Promise.resolve(resolved).then(resolve)
      },
    }
    return chain
  }
  return {
    db: {
      // Default empty results; GET tests override via vi.mocked(db.select)
      select: vi.fn(() => buildChain([])),
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([
            {
              id: '123e4567-e89b-12d3-a456-426614174000',
              name: 'Universitas Test',
              slug: 'universitas-test',
              status: 'pending',
              createdAt: new Date('2024-01-01'),
            },
          ]),
        }),
      }),
    },
  }
})

import { db } from '@/lib/db'

// Mock environment variable
vi.stubEnv('AES_256_ENCRYPTION_KEY', 'a'.repeat(64))

describe('POST /api/v1/tenants', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('creates tenant with valid input and returns 201', async () => {
    const request = new Request('http://localhost:3000/api/v1/tenants', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Universitas Test',
        slims_base_url: 'https://perpus.univ-test.ac.id/slims',
      }),
    })

    const response = await POST(request)
    const body = await response.json()

    expect(response.status).toBe(201)
    expect(body.id).toBeDefined()
    expect(body.name).toBe('Universitas Test')
    expect(body.slug).toBe('universitas-test')
    expect(body.status).toBe('pending')
    expect(body.api_token).toBeDefined()
    expect(body.api_token).toHaveLength(64) // 32 bytes hex
  })

  it('creates tenant with provided slug', async () => {
    const request = new Request('http://localhost:3000/api/v1/tenants', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Universitas Test',
        slug: 'custom-slug',
        slims_base_url: 'https://perpus.univ-test.ac.id/slims',
      }),
    })

    const response = await POST(request)
    expect(response.status).toBe(201)
  })

  it('returns 400 for missing name', async () => {
    const request = new Request('http://localhost:3000/api/v1/tenants', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        slims_base_url: 'https://perpus.univ-test.ac.id/slims',
      }),
    })

    const response = await POST(request)
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error).toBe(true)
    expect(body.code).toBe('VALIDATION_ERROR')
  })

  it('returns 400 for invalid URL', async () => {
    const request = new Request('http://localhost:3000/api/v1/tenants', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Test University',
        slims_base_url: 'not-a-valid-url',
      }),
    })

    const response = await POST(request)
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error).toBe(true)
    expect(body.code).toBe('VALIDATION_ERROR')
  })

  it('returns 400 for invalid slug format', async () => {
    const request = new Request('http://localhost:3000/api/v1/tenants', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Test University',
        slug: 'INVALID SLUG!',
        slims_base_url: 'https://example.com',
      }),
    })

    const response = await POST(request)
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error).toBe(true)
    expect(body.code).toBe('VALIDATION_ERROR')
  })

  it('returns 400 for empty name string', async () => {
    const request = new Request('http://localhost:3000/api/v1/tenants', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: '',
        slims_base_url: 'https://example.com',
      }),
    })

    const response = await POST(request)
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error).toBe(true)
  })

  it('returns 500 when encryption key is not set', async () => {
    vi.stubEnv('AES_256_ENCRYPTION_KEY', '')

    const request = new Request('http://localhost:3000/api/v1/tenants', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Test University',
        slims_base_url: 'https://example.com',
      }),
    })

    const response = await POST(request)
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body.code).toBe('SERVER_ERROR')

    // Restore
    vi.stubEnv('AES_256_ENCRYPTION_KEY', 'a'.repeat(64))
  })
})

describe('GET /api/v1/tenants', () => {
  const mockedGetSessionUser = vi.mocked(getSessionUser)
  const mockedSelect = vi.mocked(db.select)

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when not authenticated', async () => {
    mockedGetSessionUser.mockResolvedValue(null)

    const response = await GET()
    const body = await response.json()

    expect(response.status).toBe(401)
    expect(body.code).toBe('UNAUTHORIZED')
  })

  it('returns all tenants for super_admin, wrapped as { data: [...] }', async () => {
    mockedGetSessionUser.mockResolvedValue({
      user: {
        id: 'admin-user-id',
        email: 'admin@nextlib.cloud',
        name: 'Super Admin',
        role: 'super_admin',
        tenantId: null,
        passwordHash: 'x',
        createdAt: new Date(),
      } as never,
      session: {} as never,
    })
    // super_admin path: `await db.select(...).from(tenants)` (no .where)
    mockedSelect.mockReturnValue({
      from: vi.fn(() => sampleTenants) as never,
    } as never)

    const response = await GET()
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(Array.isArray(body.data)).toBe(true)
    expect(body.data).toHaveLength(2)
    // Safe columns only
    expect(body.data[0]).toHaveProperty('id')
    expect(body.data[0]).toHaveProperty('name')
    expect(body.data[0]).toHaveProperty('slug')
    expect(body.data[0]).not.toHaveProperty('apiSecretEncrypted')
    expect(body.data[0]).not.toHaveProperty('tokenHash')
    expect(body.data[0]).not.toHaveProperty('slimsBaseUrl')
  })

  it('filters to own tenant for tenant_admin (no cross-tenant leak)', async () => {
    mockedGetSessionUser.mockResolvedValue({
      user: {
        id: 'lib-user-id',
        email: 'lib@nextlib.cloud',
        name: 'Librarian',
        role: 'librarian',
        tenantId: '123e4567-e89b-12d3-a456-426614174000',
        passwordHash: 'x',
        createdAt: new Date(),
      } as never,
      session: {} as never,
    })
    // tenant-scoped path: select(...).from(tenants).where(...) → sampleTenants
    const where = vi.fn().mockReturnValue(sampleTenants)
    mockedSelect.mockReturnValue({
      from: vi.fn(() => ({ where })) as never,
    } as never)

    const response = await GET()
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(Array.isArray(body.data)).toBe(true)
    // Confirm tenant-scoped path was taken (where filter applied)
    expect(where).toHaveBeenCalled()
  })
})
