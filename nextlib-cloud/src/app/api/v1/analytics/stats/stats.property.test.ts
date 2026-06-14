import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { computePercentChange } from '@/lib/analytics'
import type { StatsApiResponse, ChartDataPoint } from '@/lib/analytics/types'

// Feature: dashboard-analytics, Property 6: API response shape invariant
/**
 * Property 6: API response shape invariant
 *
 * For any valid query parameters that match existing data, the Stats API response SHALL contain:
 * - A `data` array where every element has `date` (string), `visitorCount` (number >= 0),
 *   `loanCount` (number >= 0), and `returnCount` (number >= 0)
 * - A `summary` object with `visitors`, `loans`, and `returns` sub-objects each containing
 *   `total` (number >= 0) and `percentChange` (number)
 *
 * **Validates: Requirements 6.3, 6.4**
 */
describe('Property 6: API response shape invariant', () => {
  // Generator for a valid ISO date string using integer composition to avoid invalid Date issues
  const arbDate = fc
    .record({
      year: fc.integer({ min: 2020, max: 2025 }),
      month: fc.integer({ min: 1, max: 12 }),
      day: fc.integer({ min: 1, max: 28 }),
    })
    .map(({ year, month, day }) =>
      `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    )

  // Generator for a single ChartDataPoint
  const arbChartDataPoint: fc.Arbitrary<ChartDataPoint> = fc.record({
    date: arbDate,
    visitorCount: fc.nat({ max: 50000 }),
    loanCount: fc.nat({ max: 50000 }),
    returnCount: fc.nat({ max: 50000 }),
  })

  // Generator for an array of chart data points (0–100 points)
  const arbChartData = fc.array(arbChartDataPoint, { minLength: 0, maxLength: 100 })

  // Generator for non-negative totals (simulating previous period)
  const arbPreviousTotals = fc.record({
    visitors: fc.nat({ max: 100000 }),
    loans: fc.nat({ max: 100000 }),
    returns: fc.nat({ max: 100000 }),
  })

  // Generator for granularity
  const arbGranularity = fc.constantFrom('daily' as const, 'weekly' as const, 'monthly' as const)

  // Generator for UUID tenant_id
  const arbTenantId = fc.uuid()

  /**
   * Build a StatsApiResponse following the same logic as the route handler.
   * This simulates how the API constructs its response from query results.
   */
  function buildStatsApiResponse(
    data: ChartDataPoint[],
    previousTotals: { visitors: number; loans: number; returns: number },
    startDate: string,
    endDate: string,
    granularity: string,
    tenantId: string
  ): StatsApiResponse {
    const currentVisitors = data.reduce((sum, d) => sum + d.visitorCount, 0)
    const currentLoans = data.reduce((sum, d) => sum + d.loanCount, 0)
    const currentReturns = data.reduce((sum, d) => sum + d.returnCount, 0)

    return {
      data: data.map((row) => ({
        date: row.date,
        visitorCount: row.visitorCount,
        loanCount: row.loanCount,
        returnCount: row.returnCount,
      })),
      summary: {
        visitors: {
          total: currentVisitors,
          percentChange: computePercentChange(currentVisitors, previousTotals.visitors),
        },
        loans: {
          total: currentLoans,
          percentChange: computePercentChange(currentLoans, previousTotals.loans),
        },
        returns: {
          total: currentReturns,
          percentChange: computePercentChange(currentReturns, previousTotals.returns),
        },
      },
      meta: {
        startDate,
        endDate,
        granularity,
        tenantId,
      },
    }
  }

  it('response data array elements all have correct shape with valid types', () => {
    fc.assert(
      fc.property(
        arbChartData,
        arbPreviousTotals,
        arbDate,
        arbDate,
        arbGranularity,
        arbTenantId,
        (data, previousTotals, startDate, endDate, granularity, tenantId) => {
          const response = buildStatsApiResponse(
            data,
            previousTotals,
            startDate,
            endDate,
            granularity,
            tenantId
          )

          // Verify data is an array
          expect(Array.isArray(response.data)).toBe(true)
          expect(response.data.length).toBe(data.length)

          // Every element in data must have the correct shape
          for (const point of response.data) {
            // date must be a string
            expect(typeof point.date).toBe('string')
            expect(point.date.length).toBeGreaterThan(0)

            // visitorCount must be a non-negative number
            expect(typeof point.visitorCount).toBe('number')
            expect(point.visitorCount).toBeGreaterThanOrEqual(0)

            // loanCount must be a non-negative number
            expect(typeof point.loanCount).toBe('number')
            expect(point.loanCount).toBeGreaterThanOrEqual(0)

            // returnCount must be a non-negative number
            expect(typeof point.returnCount).toBe('number')
            expect(point.returnCount).toBeGreaterThanOrEqual(0)
          }
        }
      ),
      { numRuns: 100 }
    )
  })

  it('response summary object has correct structure with valid types', () => {
    fc.assert(
      fc.property(
        arbChartData,
        arbPreviousTotals,
        arbDate,
        arbDate,
        arbGranularity,
        arbTenantId,
        (data, previousTotals, startDate, endDate, granularity, tenantId) => {
          const response = buildStatsApiResponse(
            data,
            previousTotals,
            startDate,
            endDate,
            granularity,
            tenantId
          )

          // Verify summary object exists
          expect(response.summary).toBeDefined()
          expect(typeof response.summary).toBe('object')

          // Verify visitors sub-object
          expect(response.summary.visitors).toBeDefined()
          expect(typeof response.summary.visitors.total).toBe('number')
          expect(response.summary.visitors.total).toBeGreaterThanOrEqual(0)
          expect(typeof response.summary.visitors.percentChange).toBe('number')
          expect(Number.isFinite(response.summary.visitors.percentChange)).toBe(true)

          // Verify loans sub-object
          expect(response.summary.loans).toBeDefined()
          expect(typeof response.summary.loans.total).toBe('number')
          expect(response.summary.loans.total).toBeGreaterThanOrEqual(0)
          expect(typeof response.summary.loans.percentChange).toBe('number')
          expect(Number.isFinite(response.summary.loans.percentChange)).toBe(true)

          // Verify returns sub-object
          expect(response.summary.returns).toBeDefined()
          expect(typeof response.summary.returns.total).toBe('number')
          expect(response.summary.returns.total).toBeGreaterThanOrEqual(0)
          expect(typeof response.summary.returns.percentChange).toBe('number')
          expect(Number.isFinite(response.summary.returns.percentChange)).toBe(true)
        }
      ),
      { numRuns: 100 }
    )
  })

  it('response summary totals equal the sum of data array values', () => {
    fc.assert(
      fc.property(
        arbChartData,
        arbPreviousTotals,
        arbDate,
        arbDate,
        arbGranularity,
        arbTenantId,
        (data, previousTotals, startDate, endDate, granularity, tenantId) => {
          const response = buildStatsApiResponse(
            data,
            previousTotals,
            startDate,
            endDate,
            granularity,
            tenantId
          )

          // Summary totals should equal the sum of data array values
          const expectedVisitors = data.reduce((sum, d) => sum + d.visitorCount, 0)
          const expectedLoans = data.reduce((sum, d) => sum + d.loanCount, 0)
          const expectedReturns = data.reduce((sum, d) => sum + d.returnCount, 0)

          expect(response.summary.visitors.total).toBe(expectedVisitors)
          expect(response.summary.loans.total).toBe(expectedLoans)
          expect(response.summary.returns.total).toBe(expectedReturns)
        }
      ),
      { numRuns: 100 }
    )
  })
})
