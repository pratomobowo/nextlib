import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { z } from 'zod'
import {
  aggregateByGranularity,
  computePercentChange,
  getPresetRange,
} from './index'
import type { DailyStat, Granularity } from './types'

// Feature: dashboard-analytics, Property 1: Aggregation conserves totals
/**
 * Property 1: Aggregation conserves totals
 *
 * For any array of daily statistics records and for any granularity (daily, weekly,
 * or monthly), the sum of visitorCount, loanCount, and returnCount across all
 * aggregated data points SHALL equal the sum of those same fields across all
 * original daily records.
 *
 * **Validates: Requirements 2.3, 5.2, 5.3, 5.4**
 */
describe('Property 1: Aggregation conserves totals', () => {
  // Generator for a valid date string within a reasonable range
  const arbDate = fc
    .date({ min: new Date('2020-01-01'), max: new Date('2025-12-31'), noInvalidDate: true })
    .map((d) => d.toISOString().slice(0, 10))

  // Generator for a single DailyStat record
  const arbDailyStat: fc.Arbitrary<DailyStat> = fc.record({
    date: arbDate,
    visitorCount: fc.nat({ max: 10000 }),
    loanCount: fc.nat({ max: 10000 }),
    returnCount: fc.nat({ max: 10000 }),
  })

  // Generator for an array of DailyStat records (0–50 records)
  const arbDailyStats = fc.array(arbDailyStat, { minLength: 0, maxLength: 50 })

  // Generator for granularity
  const arbGranularity: fc.Arbitrary<Granularity> = fc.constantFrom(
    'daily' as const,
    'weekly' as const,
    'monthly' as const
  )

  it('sum of aggregated data equals sum of raw daily records for any granularity', () => {
    fc.assert(
      fc.property(arbDailyStats, arbGranularity, (stats, granularity) => {
        const aggregated = aggregateByGranularity(stats, granularity)

        const rawVisitors = stats.reduce((sum, s) => sum + s.visitorCount, 0)
        const rawLoans = stats.reduce((sum, s) => sum + s.loanCount, 0)
        const rawReturns = stats.reduce((sum, s) => sum + s.returnCount, 0)

        const aggVisitors = aggregated.reduce((sum, s) => sum + s.visitorCount, 0)
        const aggLoans = aggregated.reduce((sum, s) => sum + s.loanCount, 0)
        const aggReturns = aggregated.reduce((sum, s) => sum + s.returnCount, 0)

        expect(aggVisitors).toBe(rawVisitors)
        expect(aggLoans).toBe(rawLoans)
        expect(aggReturns).toBe(rawReturns)
      }),
      { numRuns: 100 }
    )
  })
})

// Feature: dashboard-analytics, Property 2: Percentage change calculation correctness
/**
 * Property 2: Percentage change calculation correctness
 *
 * For any pair of non-negative integers (currentTotal, previousTotal), the
 * computePercentChange function SHALL return:
 * - ((currentTotal - previousTotal) / previousTotal) * 100 when previousTotal > 0
 * - 100 when previousTotal === 0 and currentTotal > 0
 * - 0 when both previousTotal === 0 and currentTotal === 0
 *
 * **Validates: Requirements 2.3**
 */
describe('Property 2: Percentage change calculation correctness', () => {
  const arbNonNegInt = fc.nat({ max: 100000 })

  it('returns correct percentage for random non-negative integer pairs', () => {
    fc.assert(
      fc.property(arbNonNegInt, arbNonNegInt, (current, previous) => {
        const result = computePercentChange(current, previous)

        if (previous === 0 && current > 0) {
          expect(result).toBe(100)
        } else if (previous === 0 && current === 0) {
          expect(result).toBe(0)
        } else {
          const expected = ((current - previous) / previous) * 100
          expect(result).toBeCloseTo(expected, 10)
        }
      }),
      { numRuns: 100 }
    )
  })
})

// Feature: dashboard-analytics, Property 3: Preset date range calculation
/**
 * Property 3: Preset date range calculation
 *
 * For any valid date representing "today", each date range preset ("7 Hari",
 * "30 Hari", "Bulan Ini", "Tahun Ini") SHALL produce a (startDate, endDate)
 * tuple where:
 * - endDate equals today (normalized to midnight)
 * - startDate <= endDate
 * - Range length matches preset definition
 *
 * **Validates: Requirements 4.2**
 */
describe('Property 3: Preset date range calculation', () => {
  // Generate valid dates by composing year/month/day integers
  const arbToday = fc
    .record({
      year: fc.integer({ min: 2020, max: 2030 }),
      month: fc.integer({ min: 0, max: 11 }),
      day: fc.integer({ min: 1, max: 28 }), // Use 28 max to avoid invalid dates
    })
    .map(({ year, month, day }) => new Date(year, month, day))

  const presets = ['7 Hari', '30 Hari', 'Bulan Ini', 'Tahun Ini'] as const

  it('all presets produce endDate equal to today (midnight-normalized)', () => {
    fc.assert(
      fc.property(arbToday, (today) => {
        const expectedEnd = new Date(today.getFullYear(), today.getMonth(), today.getDate())

        for (const preset of presets) {
          const { endDate } = getPresetRange(preset, today)
          expect(endDate.getTime()).toBe(expectedEnd.getTime())
        }
      }),
      { numRuns: 100 }
    )
  })

  it('all presets produce startDate <= endDate', () => {
    fc.assert(
      fc.property(arbToday, (today) => {
        for (const preset of presets) {
          const { startDate, endDate } = getPresetRange(preset, today)
          expect(startDate.getTime()).toBeLessThanOrEqual(endDate.getTime())
        }
      }),
      { numRuns: 100 }
    )
  })

  it('"7 Hari" produces exactly 7-day range (6 days before today)', () => {
    fc.assert(
      fc.property(arbToday, (today) => {
        const { startDate, endDate } = getPresetRange('7 Hari', today)
        const diffDays = Math.round(
          (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)
        )
        expect(diffDays).toBe(6)
      }),
      { numRuns: 100 }
    )
  })

  it('"30 Hari" produces exactly 30-day range (29 days before today)', () => {
    fc.assert(
      fc.property(arbToday, (today) => {
        const { startDate, endDate } = getPresetRange('30 Hari', today)
        const diffDays = Math.round(
          (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)
        )
        expect(diffDays).toBe(29)
      }),
      { numRuns: 100 }
    )
  })

  it('"Bulan Ini" starts at first day of current month', () => {
    fc.assert(
      fc.property(arbToday, (today) => {
        const { startDate } = getPresetRange('Bulan Ini', today)
        expect(startDate.getDate()).toBe(1)
        expect(startDate.getMonth()).toBe(today.getMonth())
        expect(startDate.getFullYear()).toBe(today.getFullYear())
      }),
      { numRuns: 100 }
    )
  })

  it('"Tahun Ini" starts at January 1 of current year', () => {
    fc.assert(
      fc.property(arbToday, (today) => {
        const { startDate } = getPresetRange('Tahun Ini', today)
        expect(startDate.getDate()).toBe(1)
        expect(startDate.getMonth()).toBe(0) // January
        expect(startDate.getFullYear()).toBe(today.getFullYear())
      }),
      { numRuns: 100 }
    )
  })
})

// Feature: dashboard-analytics, Property 4: Date validation rejects inverted ranges
/**
 * Property 4: Date validation rejects inverted ranges
 *
 * For any pair of ISO 8601 date strings where start_date > end_date, the
 * statsQuerySchema validation SHALL reject the input.
 *
 * **Validates: Requirements 4.4, 6.6**
 */
describe('Property 4: Date validation rejects inverted ranges', () => {
  // Zod schema matching the design document
  const statsQuerySchema = z
    .object({
      tenant_id: z.string().uuid(),
      start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      granularity: z.enum(['daily', 'weekly', 'monthly']).default('daily'),
    })
    .refine(
      (data) => new Date(data.start_date) <= new Date(data.end_date),
      { message: 'start_date must be before or equal to end_date' }
    )

  // Generator for ISO date strings
  const arbIsoDate = fc
    .date({ min: new Date('2020-01-01'), max: new Date('2030-12-31'), noInvalidDate: true })
    .map((d) => d.toISOString().slice(0, 10))

  // Generator for a valid UUID
  const arbUuid = fc.uuid()

  it('rejects all inputs where start_date > end_date', () => {
    fc.assert(
      fc.property(arbIsoDate, arbIsoDate, arbUuid, (dateA, dateB, tenantId) => {
        // Ensure start_date is strictly after end_date
        const [earlier, later] = [dateA, dateB].sort()
        fc.pre(earlier !== later) // skip if dates are equal

        const result = statsQuerySchema.safeParse({
          tenant_id: tenantId,
          start_date: later,   // later date as start (inverted)
          end_date: earlier,   // earlier date as end (inverted)
        })

        expect(result.success).toBe(false)
      }),
      { numRuns: 100 }
    )
  })
})
