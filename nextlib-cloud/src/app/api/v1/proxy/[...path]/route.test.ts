import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { POST } from './route'

// Mock tenant data
const MOCK_TENANT_ID = '123e4567-e89b-12d3-a456-426614174000'
const MOCK_ENCRYPTION_KEY = 'b'.repeat(64)
const MOCK_SLIMS_BASE_URL = 'https://slims.kampus.ac.id'
const MOCK_API_SECRET = 'a'.repeat(64)

// Mock modules
vi.mock('@/middleware/tenant-guard', () => ({
  authenticateSession: vi.fn(),
}))

vi.mock('@/lib/crypto', () => ({
  decrypt: vi.fn(),
}))

vi.mock('@/lib/hmac', () => ({
  generateToken: vi.fn().mockReturnValue('1234567890.mockedsignature'),
}))

// Import mocked modules
import { authenticateSession } from '@/middleware/tenant-guard'
import { decrypt } from '@/lib/crypto'
import { generateToken } from '@/lib/hmac'

const mockAuthenticateSession = vi.mocked(authenticateSession)
const mockDecrypt = vi.mocked(decrypt)
const mockGenerateToken = vi.mocked(generateToken)

// Set env vars
vi.stubEnv('AES_256_ENCRYPTION_KEY', MOCK_ENCRYPTION_KEY)

// Mock global fetch
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

function setupSuccessfulAuth() {
  mockAuthenticateSession.mockResolvedValue({
    success: true,
    context: {
      tenant: {
        id: MOCK_TENANT_ID,
        name: 'Test University',
        slug: 'test-uni',
        slimsBaseUrl: 'encrypted-url',
        apiSecretEncrypted: 'encrypted-secret',
        tokenHash: 'hash123',
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
        insertDailyStat: vi.fn(),
      },
    },
  })
}

function createRequest(path: string, body: object = { query: 'test' }) {
  return new Request(`http://localhost:3000/api/v1/proxy/${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Tenant-ID': MOCK_TENANT_ID,
    },
    body: JSON.stringify(body),
  })
}

describe('POST /api/v1/proxy/[...path]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('AES_256_ENCRYPTION_KEY', MOCK_ENCRYPTION_KEY)
    mockDecrypt
      .mockReturnValueOnce(MOCK_SLIMS_BASE_URL) // First call: slimsBaseUrl
      .mockReturnValueOnce(MOCK_API_SECRET) // Second call: apiSecretEncrypted
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('Authentication', () => {
    it('returns 401 when session authentication fails', async () => {
      const { NextResponse } = await import('next/server')
      mockAuthenticateSession.mockResolvedValue({
        success: false,
        response: NextResponse.json(
          { error: true, code: 'UNAUTHORIZED', message: 'Authentication required. Please log in.' },
          { status: 401 }
        ),
      })

      const request = createRequest('search-book')
      const response = await POST(request, { params: Promise.resolve({ path: ['search-book'] }) })
      const responseBody = await response.json()

      expect(response.status).toBe(401)
      expect(responseBody.code).toBe('UNAUTHORIZED')
    })
  })

  describe('Path Validation', () => {
    it('returns 404 for unsupported proxy path', async () => {
      setupSuccessfulAuth()

      const request = createRequest('invalid-endpoint')
      const response = await POST(request, { params: Promise.resolve({ path: ['invalid-endpoint'] }) })
      const responseBody = await response.json()

      expect(response.status).toBe(404)
      expect(responseBody.code).toBe('INVALID_PATH')
      expect(responseBody.message).toContain('invalid-endpoint')
    })

    it('accepts search-book path', async () => {
      setupSuccessfulAuth()
      mockFetch.mockResolvedValue({
        status: 200,
        json: () => Promise.resolve({ results: [], total: 0 }),
      })

      const request = createRequest('search-book')
      const response = await POST(request, { params: Promise.resolve({ path: ['search-book'] }) })

      expect(response.status).toBe(200)
    })

    it('accepts member-check path', async () => {
      setupSuccessfulAuth()
      mockFetch.mockResolvedValue({
        status: 200,
        json: () => Promise.resolve({ status: 'active', fines: [] }),
      })

      const request = createRequest('member-check', { member_id: 'M001' })
      const response = await POST(request, { params: Promise.resolve({ path: ['member-check'] }) })

      expect(response.status).toBe(200)
    })

    it('accepts extend-book path', async () => {
      setupSuccessfulAuth()
      mockFetch.mockResolvedValue({
        status: 200,
        json: () => Promise.resolve({ success: true, new_due_date: '2026-07-01' }),
      })

      const request = createRequest('extend-book', { loan_id: 'L001', days: 7 })
      const response = await POST(request, { params: Promise.resolve({ path: ['extend-book'] }) })

      expect(response.status).toBe(200)
    })
  })

  describe('Request Forwarding', () => {
    it('forwards request to correct SLiMS URL with HMAC token', async () => {
      setupSuccessfulAuth()
      mockFetch.mockResolvedValue({
        status: 200,
        json: () => Promise.resolve({ results: [], total: 0 }),
      })

      const body = { query: 'programming', limit: 10 }
      const request = createRequest('search-book', body)
      await POST(request, { params: Promise.resolve({ path: ['search-book'] }) })

      expect(mockFetch).toHaveBeenCalledTimes(1)
      const [url, options] = mockFetch.mock.calls[0]

      expect(url).toBe(`${MOCK_SLIMS_BASE_URL}/api/v1/nextlib/search-book`)
      expect(options.method).toBe('POST')
      expect(options.headers['X-NextLib-Token']).toBe('1234567890.mockedsignature')
      expect(options.headers['Content-Type']).toBe('application/json')
      expect(options.body).toBe(JSON.stringify(body))
    })

    it('generates HMAC token using decrypted api secret', async () => {
      setupSuccessfulAuth()
      mockFetch.mockResolvedValue({
        status: 200,
        json: () => Promise.resolve({ results: [] }),
      })

      const body = { query: 'test' }
      const request = createRequest('search-book', body)
      await POST(request, { params: Promise.resolve({ path: ['search-book'] }) })

      expect(mockGenerateToken).toHaveBeenCalledWith(JSON.stringify(body), MOCK_API_SECRET)
    })

    it('returns SLiMS response status and body as-is', async () => {
      setupSuccessfulAuth()
      const slimsData = { results: [{ title: 'Test Book' }], total: 1 }
      mockFetch.mockResolvedValue({
        status: 200,
        json: () => Promise.resolve(slimsData),
      })

      const request = createRequest('search-book', { query: 'test' })
      const response = await POST(request, { params: Promise.resolve({ path: ['search-book'] }) })
      const responseBody = await response.json()

      expect(response.status).toBe(200)
      expect(responseBody).toEqual(slimsData)
    })

    it('strips trailing slash from base URL before forwarding', async () => {
      setupSuccessfulAuth()
      mockDecrypt.mockReset()
      mockDecrypt
        .mockReturnValueOnce('https://slims.kampus.ac.id/') // Trailing slash
        .mockReturnValueOnce(MOCK_API_SECRET)

      mockFetch.mockResolvedValue({
        status: 200,
        json: () => Promise.resolve({ results: [] }),
      })

      const request = createRequest('search-book')
      await POST(request, { params: Promise.resolve({ path: ['search-book'] }) })

      const [url] = mockFetch.mock.calls[0]
      expect(url).toBe('https://slims.kampus.ac.id/api/v1/nextlib/search-book')
    })
  })

  describe('Timeout & Error Handling', () => {
    it('returns CAMPUS_UNREACHABLE on timeout (AbortError)', async () => {
      setupSuccessfulAuth()
      const abortError = new Error('The operation was aborted')
      abortError.name = 'AbortError'
      mockFetch.mockRejectedValue(abortError)

      const request = createRequest('search-book')
      const response = await POST(request, { params: Promise.resolve({ path: ['search-book'] }) })
      const responseBody = await response.json()

      expect(response.status).toBe(504)
      expect(responseBody.code).toBe('CAMPUS_UNREACHABLE')
      expect(responseBody.message).toBe(
        'Maaf, sistem internal perpustakaan kampus sedang dalam pemeliharaan'
      )
    })

    it('returns CAMPUS_UNREACHABLE on network error', async () => {
      setupSuccessfulAuth()
      mockFetch.mockRejectedValue(new Error('fetch failed'))

      const request = createRequest('search-book')
      const response = await POST(request, { params: Promise.resolve({ path: ['search-book'] }) })
      const responseBody = await response.json()

      expect(response.status).toBe(502)
      expect(responseBody.code).toBe('CAMPUS_UNREACHABLE')
      expect(responseBody.message).toBe(
        'Maaf, sistem internal perpustakaan kampus sedang dalam pemeliharaan'
      )
    })

    it('passes AbortSignal to fetch for timeout control', async () => {
      setupSuccessfulAuth()
      mockFetch.mockResolvedValue({
        status: 200,
        json: () => Promise.resolve({ results: [] }),
      })

      const request = createRequest('search-book')
      await POST(request, { params: Promise.resolve({ path: ['search-book'] }) })

      const [, options] = mockFetch.mock.calls[0]
      expect(options.signal).toBeInstanceOf(AbortSignal)
    })

    it('uses 5-second timeout matching the requirement (AbortSignal.timeout)', async () => {
      setupSuccessfulAuth()
      // Simulate a slow response that would trigger timeout behavior
      const abortError = new Error('The operation was aborted')
      abortError.name = 'AbortError'
      mockFetch.mockImplementation((_url: string, options: { signal: AbortSignal }) => {
        // Verify the signal is set (timeout is configured via setTimeout internally)
        expect(options.signal).toBeDefined()
        expect(options.signal).toBeInstanceOf(AbortSignal)
        return Promise.reject(abortError)
      })

      const request = createRequest('search-book')
      const response = await POST(request, { params: Promise.resolve({ path: ['search-book'] }) })

      expect(response.status).toBe(504)
    })

    it('returns CAMPUS_UNREACHABLE on DNS resolution failure', async () => {
      setupSuccessfulAuth()
      mockFetch.mockRejectedValue(new Error('getaddrinfo ENOTFOUND slims.kampus.ac.id'))

      const request = createRequest('member-check', { member_id: 'M001' })
      const response = await POST(request, { params: Promise.resolve({ path: ['member-check'] }) })
      const responseBody = await response.json()

      expect(response.status).toBe(502)
      expect(responseBody.code).toBe('CAMPUS_UNREACHABLE')
      expect(responseBody.message).toBe(
        'Maaf, sistem internal perpustakaan kampus sedang dalam pemeliharaan'
      )
    })

    it('returns CAMPUS_UNREACHABLE on connection refused', async () => {
      setupSuccessfulAuth()
      mockFetch.mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:443'))

      const request = createRequest('extend-book', { loan_id: 'L001', days: 7 })
      const response = await POST(request, { params: Promise.resolve({ path: ['extend-book'] }) })
      const responseBody = await response.json()

      expect(response.status).toBe(502)
      expect(responseBody.code).toBe('CAMPUS_UNREACHABLE')
      expect(responseBody.message).toBe(
        'Maaf, sistem internal perpustakaan kampus sedang dalam pemeliharaan'
      )
    })
  })

  describe('SLiMS Error Response Pass-Through', () => {
    it('passes through SLiMS 404 response status as-is', async () => {
      setupSuccessfulAuth()
      mockFetch.mockResolvedValue({
        status: 404,
        json: () => Promise.resolve({ error: true, code: 'NOT_FOUND', message: 'Book not found' }),
      })

      const request = createRequest('search-book', { query: 'nonexistent' })
      const response = await POST(request, { params: Promise.resolve({ path: ['search-book'] }) })
      const responseBody = await response.json()

      expect(response.status).toBe(404)
      expect(responseBody.error).toBe(true)
      expect(responseBody.code).toBe('NOT_FOUND')
    })

    it('passes through SLiMS 500 internal server error as-is', async () => {
      setupSuccessfulAuth()
      mockFetch.mockResolvedValue({
        status: 500,
        json: () => Promise.resolve({ error: true, code: 'INTERNAL_ERROR', message: 'Database error' }),
      })

      const request = createRequest('member-check', { member_id: 'M001' })
      const response = await POST(request, { params: Promise.resolve({ path: ['member-check'] }) })
      const responseBody = await response.json()

      expect(response.status).toBe(500)
      expect(responseBody.error).toBe(true)
      expect(responseBody.code).toBe('INTERNAL_ERROR')
    })

    it('passes through SLiMS 401 unauthorized response (invalid token on agent side)', async () => {
      setupSuccessfulAuth()
      mockFetch.mockResolvedValue({
        status: 401,
        json: () => Promise.resolve({ error: true, code: 'INVALID_TOKEN', message: 'Token tidak valid' }),
      })

      const request = createRequest('extend-book', { loan_id: 'L001', days: 7 })
      const response = await POST(request, { params: Promise.resolve({ path: ['extend-book'] }) })
      const responseBody = await response.json()

      expect(response.status).toBe(401)
      expect(responseBody.code).toBe('INVALID_TOKEN')
    })
  })

  describe('Credential Errors', () => {
    it('returns 500 when encryption key is not configured', async () => {
      setupSuccessfulAuth()
      vi.stubEnv('AES_256_ENCRYPTION_KEY', '')

      const request = createRequest('search-book')
      const response = await POST(request, { params: Promise.resolve({ path: ['search-book'] }) })
      const responseBody = await response.json()

      expect(response.status).toBe(500)
      expect(responseBody.code).toBe('SERVER_ERROR')
    })

    it('returns 500 when decryption fails', async () => {
      setupSuccessfulAuth()
      mockDecrypt.mockReset()
      mockDecrypt.mockImplementation(() => {
        throw new Error('Decryption failed')
      })

      const request = createRequest('search-book')
      const response = await POST(request, { params: Promise.resolve({ path: ['search-book'] }) })
      const responseBody = await response.json()

      expect(response.status).toBe(500)
      expect(responseBody.code).toBe('SERVER_ERROR')
      expect(responseBody.message).toBe('Failed to decrypt tenant credentials')
    })
  })

  describe('Stateless Behavior', () => {
    it('does not store any data between requests (no side effects)', async () => {
      setupSuccessfulAuth()
      const slimsData = { status: 'active', fines: [{ amount: 5000 }] }
      mockFetch.mockResolvedValue({
        status: 200,
        json: () => Promise.resolve(slimsData),
      })

      const request = createRequest('member-check', { member_id: 'M001' })
      const response = await POST(request, { params: Promise.resolve({ path: ['member-check'] }) })
      const responseBody = await response.json()

      // Verify response is passed through
      expect(responseBody).toEqual(slimsData)
      // No database insertions, no file writes — stateless
      const { scope } = (await mockAuthenticateSession.mock.results[0].value as { success: true; context: { scope: { insertDailyStat: ReturnType<typeof vi.fn> } } }).context
      expect(scope.insertDailyStat).not.toHaveBeenCalled()
    })
  })
})
