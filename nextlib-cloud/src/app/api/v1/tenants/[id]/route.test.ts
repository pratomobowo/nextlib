import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GET, PATCH } from './route'

// ---------------------------------------------------------------------------
// Hoisted shared mock state
//
// `vi.mock` factories are hoisted above imports, so any module-level state
// they reference must be defined via `vi.hoisted` (also hoisted). Plain
// `const` declarations at module scope are not yet initialized when the mock
// factory runs.
// ---------------------------------------------------------------------------
const {
  mockGetSessionUser,
  mockCheckRateLimit,
  mockWriteAuditLog,
  mockCheckTenantAccess,
  mockEncrypt,
  mockDecrypt,
  mockDbSelect,
  mockDbUpdate,
  mockAuthenticateSession,
} = vi.hoisted(() => ({
  mockGetSessionUser: vi.fn(),
  mockCheckRateLimit: vi.fn(),
  mockWriteAuditLog: vi.fn(),
  mockCheckTenantAccess: vi.fn(),
  mockEncrypt: vi.fn(),
  mockDecrypt: vi.fn(),
  mockDbSelect: vi.fn(),
  mockDbUpdate: vi.fn(),
  mockAuthenticateSession: vi.fn(),
}))

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------
vi.mock('@/lib/auth/session', () => ({
  getSessionUser: (...args: unknown[]) => mockGetSessionUser(...args),
}))

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
}))

vi.mock('@/lib/tenant-audit', () => ({
  writeAuditLog: (...args: unknown[]) => mockWriteAuditLog(...args),
}))

vi.mock('@/lib/tenant-access-guard', () => ({
  checkTenantAccess: (...args: unknown[]) => mockCheckTenantAccess(...args),
}))

vi.mock('@/lib/crypto', () => ({
  encrypt: (...args: unknown[]) => mockEncrypt(...args),
  decrypt: (...args: unknown[]) => mockDecrypt(...args),
}))

vi.mock('@/middleware/tenant-guard', () => ({
  authenticateSession: (...args: unknown[]) => mockAuthenticateSession(...args),
}))

vi.mock('@/lib/db', () => ({
  db: {
    select: (...args: unknown[]) => mockDbSelect(...args),
    update: (...args: unknown[]) => mockDbUpdate(...args),
  },
}))

vi.stubEnv('AES_256_ENCRYPTION_KEY', 'a'.repeat(64))

// ---------------------------------------------------------------------------
// Sample data
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Chainable DB builders
//
// Drizzle queries are chainable: select().from().where().limit() and
// update().set().where().returning(). We build chain mocks per-test so
// the `beforeEach` can swap the resolved value for a specific scenario.
// ---------------------------------------------------------------------------
function buildSelectChain(resolved: unknown) {
  const limit = vi.fn().mockResolvedValue(resolved)
  const where = vi.fn().mockReturnValue({ limit })
  const from = vi.fn().mockReturnValue({ where })
  return { from, where, limit }
}

function buildUpdateChain(returned: unknown) {
  const returning = vi.fn().mockResolvedValue(returned)
  const where = vi.fn().mockReturnValue({ returning })
  const set = vi.fn().mockReturnValue({ where })
  return { set, where, returning }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function createGetRequest(tenantIdHeader?: string): Request {
  const headers: Record<string, string> = {}
  if (tenantIdHeader) {
    headers['x-tenant-id'] = tenantIdHeader
  }
  return new Request(`http://localhost:3000/api/v1/tenants/${mockTenantId}`, {
    method: 'GET',
    headers,
  })
}

function createPatchRequest(
  body: unknown,
  url = `http://localhost:3000/api/v1/tenants/${mockTenantId}`
): Request {
  return new Request(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function mockAuthSuccess(tenantId: string = mockTenantId) {
  mockAuthenticateSession.mockResolvedValue({
    success: true,
    context: {
      tenant: { ...mockTenantRecord, id: tenantId },
      scope: {
        tenantId,
        tenantFilter: vi.fn(),
        getDailyStats: vi.fn(),
        getDailyStatsByDate: vi.fn(),
        insertDailyStat: vi.fn(),
      },
    },
  })
}

type Role = 'tenant_admin' | 'librarian' | 'super_admin'

function mockSession(
  role: Role,
  opts: { tenantId?: string | null; userId?: string; email?: string } = {}
) {
  const tenantId = opts.tenantId !== undefined ? opts.tenantId : mockTenantId
  mockGetSessionUser.mockResolvedValue({
    user: {
      id: opts.userId ?? 'user-id-1',
      email: opts.email ?? `${role}@x.com`,
      name: 'Sample User',
      role,
      tenantId,
      passwordHash: 'x',
      createdAt: new Date(),
    },
    session: {
      id: 'session-id',
      userId: opts.userId ?? 'user-id-1',
      expiresAt: new Date(),
      createdAt: new Date(),
    },
  })
}

function mockAccess(result: { allowed: true } | { allowed: false; status: number; code: string; message: string }) {
  mockCheckTenantAccess.mockReturnValue(result)
}

function mockRateLimit(allowed: boolean, remaining = allowed ? 29 : 0, resetSec = 60) {
  mockCheckRateLimit.mockResolvedValue({ allowed, remaining, resetSec })
}

// ---------------------------------------------------------------------------
// GET tests (existing — kept intact)
// ---------------------------------------------------------------------------
describe('GET /api/v1/tenants/:id', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('AES_256_ENCRYPTION_KEY', 'a'.repeat(64))
    // GET chain: db.select().from().where().limit(1) → [mockTenantRecord]
    const chain = buildSelectChain([mockTenantRecord])
    mockDbSelect.mockReturnValue(chain)
    mockDecrypt.mockReturnValue('https://perpus.univ-test.ac.id/slims')
  })

  it('returns tenant details with decrypted slims_base_url for authorized request', async () => {
    mockAuthSuccess()

    const request = createGetRequest(mockTenantId)
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

    const request = createGetRequest()
    const response = await GET(request, { params: Promise.resolve({ id: mockTenantId }) })
    const body = await response.json()

    expect(response.status).toBe(401)
    expect(body.error).toBe(true)
    expect(body.code).toBe('UNAUTHORIZED')
  })

  it('returns 403 when tenant tries to access another tenant data', async () => {
    mockAuthSuccess(mockTenantId)

    const request = createGetRequest(mockTenantId)
    const response = await GET(request, { params: Promise.resolve({ id: otherTenantId }) })
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body.error).toBe(true)
    expect(body.code).toBe('FORBIDDEN')
  })

  it('returns 404 when tenant not found in database', async () => {
    mockAuthSuccess()
    // Override the SELECT chain to return empty
    const emptyChain = buildSelectChain([])
    mockDbSelect.mockReturnValue(emptyChain)

    const request = createGetRequest(mockTenantId)
    const response = await GET(request, { params: Promise.resolve({ id: mockTenantId }) })
    const body = await response.json()

    expect(response.status).toBe(404)
    expect(body.error).toBe(true)
    expect(body.code).toBe('NOT_FOUND')
  })

  it('returns 500 when encryption key is not configured', async () => {
    vi.stubEnv('AES_256_ENCRYPTION_KEY', '')
    mockAuthSuccess()

    const request = createGetRequest(mockTenantId)
    const response = await GET(request, { params: Promise.resolve({ id: mockTenantId }) })
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body.error).toBe(true)
    expect(body.code).toBe('SERVER_ERROR')
  })

  it('never exposes api_secret_encrypted or token_hash in response', async () => {
    mockAuthSuccess()

    const request = createGetRequest(mockTenantId)
    const response = await GET(request, { params: Promise.resolve({ id: mockTenantId }) })
    const body = await response.json()

    expect(response.status).toBe(200)
    const responseKeys = Object.keys(body)
    expect(responseKeys).not.toContain('api_secret_encrypted')
    expect(responseKeys).not.toContain('apiSecretEncrypted')
    expect(responseKeys).not.toContain('token_hash')
    expect(responseKeys).not.toContain('tokenHash')
    expect(responseKeys).not.toContain('slimsBaseUrl') // Only decrypted slims_base_url
  })
})

// ---------------------------------------------------------------------------
// PATCH tests (new — multi-field, rate-limited, audit-logged)
// ---------------------------------------------------------------------------
describe('PATCH /api/v1/tenants/:id', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('AES_256_ENCRYPTION_KEY', 'a'.repeat(64))
    // Defaults: happy-path auth, rate limit allowed, tenant exists, update returns row
    mockSession('tenant_admin')
    mockAccess({ allowed: true })
    mockRateLimit(true)
    const selectChain = buildSelectChain([mockTenantRecord])
    mockDbSelect.mockReturnValue(selectChain)
    const updatedRow = {
      ...mockTenantRecord,
      name: 'Universitas Test Updated',
      updatedAt: new Date('2024-01-03'),
    }
    const updateChain = buildUpdateChain([updatedRow])
    mockDbUpdate.mockReturnValue(updateChain)
    // Crypto defaults
    mockDecrypt.mockReturnValue('https://perpus.univ-test.ac.id/slims')
    mockEncrypt.mockReturnValue('new-encrypted-url')
  })

  // ---- 1. tenant_admin can update own tenant ----
  it('tenant_admin can update own tenant', async () => {
    const request = createPatchRequest({ name: 'Universitas Test Updated' })
    const response = await PATCH(request, { params: Promise.resolve({ id: mockTenantId }) })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data).toBeDefined()
    expect(body.data.id).toBe(mockTenantId)
    expect(body.data.name).toBe('Universitas Test Updated')
    // Owner gets decrypted URL
    expect(body.data.slims_base_url).toBe('https://perpus.univ-test.ac.id/slims')
  })

  // ---- 2. tenant_admin cannot update other tenant ----
  it('tenant_admin cannot update other tenant', async () => {
    mockAccess({
      allowed: false,
      status: 403,
      code: 'FORBIDDEN',
      message: 'You do not have access to this tenant.',
    })

    const request = createPatchRequest(
      { name: 'Hacked' },
      `http://localhost:3000/api/v1/tenants/${otherTenantId}`
    )
    const response = await PATCH(request, { params: Promise.resolve({ id: otherTenantId }) })
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body.error).toBe(true)
    expect(body.code).toBe('FORBIDDEN')
  })

  // ---- 3. super_admin can update any tenant ----
  it('super_admin can update any tenant', async () => {
    mockSession('super_admin', { tenantId: null })

    const request = createPatchRequest(
      { name: 'Universitas Test Updated' },
      `http://localhost:3000/api/v1/tenants/${otherTenantId}`
    )
    const response = await PATCH(request, { params: Promise.resolve({ id: otherTenantId }) })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data).toBeDefined()
    expect(body.data.name).toBe('Universitas Test Updated')
  })

  // ---- 4. librarian can update own tenant ----
  it('librarian can update own tenant', async () => {
    mockSession('librarian')

    const request = createPatchRequest({ name: 'Universitas Test Updated' })
    const response = await PATCH(request, { params: Promise.resolve({ id: mockTenantId }) })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data).toBeDefined()
    expect(body.data.name).toBe('Universitas Test Updated')
  })

  // ---- 5. empty body returns 400 NO_OP ----
  it('empty body returns 400 NO_OP', async () => {
    const request = createPatchRequest({})
    const response = await PATCH(request, { params: Promise.resolve({ id: mockTenantId }) })
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error).toBe(true)
    expect(body.code).toBe('NO_OP')
  })

  // ---- 6. invalid URL returns 400 ----
  it('invalid URL returns 400', async () => {
    const request = createPatchRequest({ slims_base_url: 'not-a-valid-url' })
    const response = await PATCH(request, { params: Promise.resolve({ id: mockTenantId }) })
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error).toBe(true)
    expect(body.code).toBe('VALIDATION_ERROR')
  })

  // ---- 7. invalid status returns 400 ----
  it('invalid status returns 400', async () => {
    const request = createPatchRequest({ status: 'unknown' })
    const response = await PATCH(request, { params: Promise.resolve({ id: mockTenantId }) })
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error).toBe(true)
    expect(body.code).toBe('VALIDATION_ERROR')
  })

  // ---- 8. slug in body is silently ignored ----
  it('slug in body is silently ignored', async () => {
    const request = createPatchRequest({
      name: 'Universitas Test Updated',
      slug: 'new-slug',
    })
    const response = await PATCH(request, { params: Promise.resolve({ id: mockTenantId }) })
    const body = await response.json()

    expect(response.status).toBe(200)
    // Zod strips unknown fields, so the slug in the request body is dropped
    // before the DB update. The response reflects the unchanged DB value.
    expect(body.data.slug).toBe('universitas-test')
    // Only one audit log entry: for the `name` change. `slug` is silently dropped.
    expect(mockWriteAuditLog).toHaveBeenCalledTimes(1)
    expect(mockWriteAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ fieldName: 'name' })
    )
  })

  // ---- 9. unchanged field produces no audit log ----
  it('unchanged field produces no audit log', async () => {
    // PATCH with the same name that's already in the DB
    const request = createPatchRequest({ name: 'Universitas Test' })
    const response = await PATCH(request, { params: Promise.resolve({ id: mockTenantId }) })

    expect(response.status).toBe(200)
    expect(mockWriteAuditLog).not.toHaveBeenCalled()
  })

  // ---- 10. changed field produces 1 audit log row ----
  it('changed field produces 1 audit log row', async () => {
    const request = createPatchRequest({ name: 'Universitas Test Updated' })
    const response = await PATCH(request, { params: Promise.resolve({ id: mockTenantId }) })

    expect(response.status).toBe(200)
    expect(mockWriteAuditLog).toHaveBeenCalledTimes(1)
    expect(mockWriteAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: mockTenantId,
        actorUserId: 'user-id-1',
        actorEmail: 'tenant_admin@x.com',
        action: 'field_update',
        fieldName: 'name',
        oldValue: 'Universitas Test',
        newValue: 'Universitas Test Updated',
      })
    )
  })

  // ---- 11. 31st request in 1min returns 429 ----
  it('31st request in 1min returns 429', async () => {
    mockRateLimit(false, 0, 42)

    const request = createPatchRequest({ name: 'Universitas Test Updated' })
    const response = await PATCH(request, { params: Promise.resolve({ id: mockTenantId }) })
    const body = await response.json()

    expect(response.status).toBe(429)
    expect(body.error).toBe(true)
    expect(body.code).toBe('RATE_LIMITED')
    expect(response.headers.get('Retry-After')).toBe('42')
  })

  // ---- 12. slimsBaseUrl decrypted in response only for owner ----
  it('slimsBaseUrl decrypted in response only for owner', async () => {
    // super_admin (no tenantId) is NOT the owner — should see [ENCRYPTED]
    mockSession('super_admin', { tenantId: null })
    // decrypt would return the real URL, but the function must not call it for non-owners
    const request = createPatchRequest({ name: 'Universitas Test Updated' })
    const response = await PATCH(request, { params: Promise.resolve({ id: mockTenantId }) })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data.slims_base_url).toBe('[ENCRYPTED]')
    // No slims_base_url in body and user is not owner → decrypt must never run.
    // Guards against a future regression that decrypts unconditionally and then masks.
    expect(mockDecrypt).not.toHaveBeenCalled()
  })

  // ---- 13. 409 STALE_WRITE when expectedUpdatedAt does not match ----
  it('returns 409 STALE_WRITE when expectedUpdatedAt does not match', async () => {
    // Override the SELECT chain so existing.updatedAt is a known instant.
    const existingWithDate = {
      ...mockTenantRecord,
      updatedAt: new Date('2026-06-15T10:00:00Z'),
    }
    const selectChain = buildSelectChain([existingWithDate])
    mockDbSelect.mockReturnValue(selectChain)

    const request = createPatchRequest({
      name: 'Universitas Test Updated',
      expectedUpdatedAt: '2026-06-15T09:00:00Z', // 1h stale
    })
    const response = await PATCH(request, { params: Promise.resolve({ id: mockTenantId }) })
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body.error).toBe(true)
    expect(body.code).toBe('STALE_WRITE')
    // Must not have mutated the DB or written an audit log on a stale write.
    expect(mockDbUpdate).not.toHaveBeenCalled()
    expect(mockWriteAuditLog).not.toHaveBeenCalled()
  })

  // ---- 14. Multi-field PATCH writes 1 audit log row per changed field ----
  it('writes 1 audit log row per changed field for multi-field PATCH', async () => {
    // existing.name = 'Universitas Test', existing.status = 'pending'
    // (slimsBaseUrl is unchanged and not in the body, so no audit row for it)
    const existing = {
      ...mockTenantRecord,
      name: 'Universitas Test',
      status: 'pending',
    }
    const selectChain = buildSelectChain([existing])
    mockDbSelect.mockReturnValue(selectChain)

    const updatedRow = {
      ...existing,
      name: 'Universitas Test Updated',
      status: 'connected',
      updatedAt: new Date('2024-01-03'),
    }
    const updateChain = buildUpdateChain([updatedRow])
    mockDbUpdate.mockReturnValue(updateChain)

    const request = createPatchRequest({
      name: 'Universitas Test Updated',
      status: 'connected',
    })
    const response = await PATCH(request, { params: Promise.resolve({ id: mockTenantId }) })

    expect(response.status).toBe(200)
    // Exactly 2 audit log rows: one per changed field.
    expect(mockWriteAuditLog).toHaveBeenCalledTimes(2)
    expect(mockWriteAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        fieldName: 'name',
        oldValue: 'Universitas Test',
        newValue: 'Universitas Test Updated',
      })
    )
    expect(mockWriteAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        fieldName: 'status',
        oldValue: 'pending',
        newValue: 'connected',
      })
    )
    // No audit row for slims_base_url — it wasn't in the body and didn't change.
    expect(mockWriteAuditLog).not.toHaveBeenCalledWith(
      expect.objectContaining({ fieldName: 'slims_base_url' })
    )
  })
})
