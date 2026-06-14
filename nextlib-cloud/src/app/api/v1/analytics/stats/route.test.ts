import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// Valid UUIDs for testing
const VALID_TENANT_ID = '123e4567-e89b-12d3-a456-426614174000'
const NONEXISTENT_TENANT_ID = '999e4567-e89b-12d3-a456-426614174999'

// Mock the database module
const mockDbSelect = vi.fn()
const mockDbExecute = vi.fn()

vi.mock('@/lib/db', () => ({
  db: {
    select: (...args: unknown[]) => mockDbSelect(...args),
    execute: (...args: unknown[]) => mockDbExecute(...args),
  },
}))

// Mock drizzle-orm operators
vi.mock('drizzle-orm', () => ({
  eq: vi.fn((...args: unknown[]) => ({ type: 'eq', args })),
  and: vi.fn((...args: unknown[]) => ({ type: 'and', args })),
  between: vi.fn((...args: unknown[]) => ({ type: 'between', args })),
  sql: Object.assign(
    (strings: TemplateStringsArray, ...values: unknown[]) => ({ type: 'sql', strings, values }),
    { raw: (s: string) => s }
  ),
}))

// Mock session helper to return a mock super admin session
vi.mock("@/lib/auth/session", () => ({
  getSessionUser: vi.fn().mockResolvedValue({
    user: {
      id: "mock-user-1234",
      name: "Mock Super Admin",
      email: "admin@nextlib.cloud",
      role: "super_admin",
      tenantId: null,
    },
    session: {
      id: "mock-session-1234",
      userId: "mock-user-1234",
      expiresAt: new Date(Date.now() + 1000 * 60 * 60).toISOString(),
    },
  }),
}))

import { GET } from './route'

/**
 * Helper to create a NextRequest with search params for the stats endpoint.
 */
function createStatsRequest(params: Record<string, string>): NextRequest {
  const url = new URL('http://localhost:3000/api/v1/analytics/stats')
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value)
  }
  return new NextRequest(url)
}

/**
 * Set up mocks for a successful tenant lookup + data query.
 */
function setupSuccessfulMocks(options?: {
  dailyData?: { date: string; visitorCount: number; loanCount: number; returnCount: number }[]
  currentTotals?: { visitors: number; loans: number; returns: number }
  previousTotals?: { visitors: number; loans: number; returns: number }
}) {
  const dailyData = options?.dailyData ?? [
    { date: '2024-06-01', visitorCount: 100, loanCount: 50, returnCount: 30 },
    { date: '2024-06-02', visitorCount: 120, loanCount: 60, returnCount: 40 },
  ]
  const currentTotals = options?.currentTotals ?? { visitors: 220, loans: 110, returns: 70 }
  const previousTotals = options?.previousTotals ?? { visitors: 200, loans: 100, returns: 60 }

  // Chain: db.select().from().where().limit() → tenant found
  // Chain: db.select().from().where().orderBy() → daily data
  // Chain: db.select().from().where() → current totals
  // Chain: db.select().from().where() → previous totals
  let selectCallCount = 0

  mockDbSelect.mockImplementation(() => {
    selectCallCount++
    const callNum = selectCallCount

    const chain: Record<string, unknown> = {}
    chain.from = vi.fn().mockReturnValue(chain)
    chain.where = vi.fn().mockReturnValue(chain)
    chain.orderBy = vi.fn().mockImplementation(() => {
      // This is the daily data query
      return Promise.resolve(dailyData)
    })
    chain.limit = vi.fn().mockImplementation(() => {
      // This is the tenant check query
      if (callNum === 1) {
        return Promise.resolve([{ id: VALID_TENANT_ID }])
      }
      return Promise.resolve([])
    })

    // If no orderBy or limit is called, it's a totals query
    // Override the where to return a promise directly for totals
    const originalWhere = chain.where as ReturnType<typeof vi.fn>
    chain.where = vi.fn().mockImplementation((...args: unknown[]) => {
      const result = {
        ...chain,
        where: chain.where,
        limit: chain.limit,
        orderBy: chain.orderBy,
        then: (resolve: (value: unknown) => void) => {
          // totals query (no orderBy/limit chained after)
          if (callNum === 3) {
            resolve([currentTotals])
          } else if (callNum === 4) {
            resolve([previousTotals])
          } else {
            resolve([])
          }
        },
      }
      return result
    })

    return chain
  })
}

/**
 * Set up mocks where tenant is NOT found.
 */
function setupTenantNotFoundMocks() {
  mockDbSelect.mockImplementation(() => {
    const chain: Record<string, unknown> = {}
    chain.from = vi.fn().mockReturnValue(chain)
    chain.where = vi.fn().mockReturnValue(chain)
    chain.orderBy = vi.fn().mockResolvedValue([])
    chain.limit = vi.fn().mockResolvedValue([]) // tenant not found
    return chain
  })
}

/**
 * Set up mocks where tenant exists but no data in range.
 */
function setupEmptyDataMocks() {
  let selectCallCount = 0

  mockDbSelect.mockImplementation(() => {
    selectCallCount++
    const callNum = selectCallCount

    const chain: Record<string, unknown> = {}
    chain.from = vi.fn().mockReturnValue(chain)
    chain.where = vi.fn().mockReturnValue(chain)
    chain.orderBy = vi.fn().mockResolvedValue([]) // no daily data
    chain.limit = vi.fn().mockImplementation(() => {
      if (callNum === 1) {
        return Promise.resolve([{ id: VALID_TENANT_ID }]) // tenant exists
      }
      return Promise.resolve([])
    })

    // For totals queries, return zeros
    const outerChain = chain
    chain.where = vi.fn().mockImplementation(() => {
      const result = {
        from: outerChain.from,
        where: outerChain.where,
        limit: outerChain.limit,
        orderBy: outerChain.orderBy,
        then: (resolve: (value: unknown) => void) => {
          resolve([{ visitors: 0, loans: 0, returns: 0 }])
        },
      }
      return result
    })

    return chain
  })
}

describe('GET /api/v1/analytics/stats', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Parameter Validation', () => {
    it('returns 400 MISSING_TENANT_ID when tenant_id is missing', async () => {
      const request = createStatsRequest({
        start_date: '2024-06-01',
        end_date: '2024-06-30',
      })

      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body.error).toBe(true)
      expect(body.code).toBe('MISSING_TENANT_ID')
      expect(body.message).toBe('tenant_id parameter is required')
    })

    it('returns 400 INVALID_TENANT_ID when tenant_id is not a valid UUID', async () => {
      const request = createStatsRequest({
        tenant_id: 'not-a-valid-uuid',
        start_date: '2024-06-01',
        end_date: '2024-06-30',
      })

      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body.error).toBe(true)
      expect(body.code).toBe('INVALID_TENANT_ID')
      expect(body.message).toBe('tenant_id must be a valid UUID')
    })

    it('returns 400 MISSING_DATE_RANGE when start_date is missing', async () => {
      const request = createStatsRequest({
        tenant_id: VALID_TENANT_ID,
        end_date: '2024-06-30',
      })

      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body.error).toBe(true)
      expect(body.code).toBe('MISSING_DATE_RANGE')
      expect(body.message).toBe('start_date and end_date are required')
    })

    it('returns 400 MISSING_DATE_RANGE when end_date is missing', async () => {
      const request = createStatsRequest({
        tenant_id: VALID_TENANT_ID,
        start_date: '2024-06-01',
      })

      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body.error).toBe(true)
      expect(body.code).toBe('MISSING_DATE_RANGE')
      expect(body.message).toBe('start_date and end_date are required')
    })

    it('returns 400 INVALID_DATE_FORMAT when start_date has invalid format', async () => {
      const request = createStatsRequest({
        tenant_id: VALID_TENANT_ID,
        start_date: '06-01-2024',
        end_date: '2024-06-30',
      })

      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body.error).toBe(true)
      expect(body.code).toBe('INVALID_DATE_FORMAT')
      expect(body.message).toBe('Dates must be in YYYY-MM-DD format')
    })

    it('returns 400 INVALID_DATE_FORMAT when end_date has invalid format', async () => {
      const request = createStatsRequest({
        tenant_id: VALID_TENANT_ID,
        start_date: '2024-06-01',
        end_date: 'June 30, 2024',
      })

      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body.error).toBe(true)
      expect(body.code).toBe('INVALID_DATE_FORMAT')
      expect(body.message).toBe('Dates must be in YYYY-MM-DD format')
    })

    it('returns 400 INVALID_DATE_RANGE when start_date > end_date', async () => {
      const request = createStatsRequest({
        tenant_id: VALID_TENANT_ID,
        start_date: '2024-07-01',
        end_date: '2024-06-01',
      })

      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body.error).toBe(true)
      expect(body.code).toBe('INVALID_DATE_RANGE')
      expect(body.message).toBe('start_date must be before or equal to end_date')
    })

    it('returns 400 INVALID_GRANULARITY when granularity is not a valid value', async () => {
      const request = createStatsRequest({
        tenant_id: VALID_TENANT_ID,
        start_date: '2024-06-01',
        end_date: '2024-06-30',
        granularity: 'yearly',
      })

      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body.error).toBe(true)
      expect(body.code).toBe('INVALID_GRANULARITY')
      expect(body.message).toBe('granularity must be one of: daily, weekly, monthly')
    })
  })

  describe('Tenant Not Found', () => {
    it('returns 404 TENANT_NOT_FOUND when tenant does not exist', async () => {
      setupTenantNotFoundMocks()

      const request = createStatsRequest({
        tenant_id: NONEXISTENT_TENANT_ID,
        start_date: '2024-06-01',
        end_date: '2024-06-30',
      })

      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(404)
      expect(body.error).toBe(true)
      expect(body.code).toBe('TENANT_NOT_FOUND')
      expect(body.message).toBe('No tenant found with the given ID')
    })
  })

  describe('Successful Responses', () => {
    it('returns 200 with correct StatsApiResponse shape for valid params', async () => {
      setupSuccessfulMocks()

      const request = createStatsRequest({
        tenant_id: VALID_TENANT_ID,
        start_date: '2024-06-01',
        end_date: '2024-06-30',
      })

      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(200)

      // Check response shape
      expect(body).toHaveProperty('data')
      expect(body).toHaveProperty('summary')
      expect(body).toHaveProperty('meta')

      // Check data array shape
      expect(Array.isArray(body.data)).toBe(true)
      for (const point of body.data) {
        expect(point).toHaveProperty('date')
        expect(point).toHaveProperty('visitorCount')
        expect(point).toHaveProperty('loanCount')
        expect(point).toHaveProperty('returnCount')
        expect(typeof point.date).toBe('string')
        expect(typeof point.visitorCount).toBe('number')
        expect(typeof point.loanCount).toBe('number')
        expect(typeof point.returnCount).toBe('number')
      }

      // Check summary shape
      expect(body.summary).toHaveProperty('visitors')
      expect(body.summary).toHaveProperty('loans')
      expect(body.summary).toHaveProperty('returns')
      expect(body.summary.visitors).toHaveProperty('total')
      expect(body.summary.visitors).toHaveProperty('percentChange')
      expect(body.summary.loans).toHaveProperty('total')
      expect(body.summary.loans).toHaveProperty('percentChange')
      expect(body.summary.returns).toHaveProperty('total')
      expect(body.summary.returns).toHaveProperty('percentChange')

      // Check meta shape
      expect(body.meta).toEqual({
        startDate: '2024-06-01',
        endDate: '2024-06-30',
        granularity: 'daily',
        tenantId: VALID_TENANT_ID,
      })
    })

    it('returns 200 with default granularity "daily" when not specified', async () => {
      setupSuccessfulMocks()

      const request = createStatsRequest({
        tenant_id: VALID_TENANT_ID,
        start_date: '2024-06-01',
        end_date: '2024-06-30',
      })

      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.meta.granularity).toBe('daily')
    })

    it('returns 200 with specified granularity in meta', async () => {
      setupSuccessfulMocks()
      // Weekly/monthly granularity uses db.execute() for DATE_TRUNC queries
      mockDbExecute.mockResolvedValue({
        rows: [
          { date: '2024-06-03', visitor_count: 220, loan_count: 110, return_count: 70 },
        ],
      })

      const request = createStatsRequest({
        tenant_id: VALID_TENANT_ID,
        start_date: '2024-06-01',
        end_date: '2024-06-30',
        granularity: 'weekly',
      })

      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.meta.granularity).toBe('weekly')
    })
  })

  describe('Empty Data Range', () => {
    it('returns 200 with empty data and zero totals when no data in range', async () => {
      setupEmptyDataMocks()

      const request = createStatsRequest({
        tenant_id: VALID_TENANT_ID,
        start_date: '2020-01-01',
        end_date: '2020-01-31',
      })

      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.data).toEqual([])
      expect(body.summary).toEqual({
        visitors: { total: 0, percentChange: 0 },
        loans: { total: 0, percentChange: 0 },
        returns: { total: 0, percentChange: 0 },
      })
    })
  })
})
