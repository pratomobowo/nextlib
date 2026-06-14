/**
 * Analytics utility module — core logic for Dashboard Analytics.
 *
 * Contains pure functions for:
 * - Percentage change calculations
 * - Date range preset resolution
 * - Data aggregation by granularity
 */

import type { ChartDataPoint, DailyStat, DateRangePreset, Granularity } from "./types"

export type { ChartDataPoint, DailyStat, DateRangePreset, Granularity }
export type { StatsApiResponse, StatsApiError } from "./types"

/**
 * Compute the percentage change between a current and previous total.
 *
 * Formula:
 * - previousTotal > 0: ((current - previous) / previous) * 100
 * - previousTotal === 0 and current > 0: 100
 * - Both zero: 0
 */
export function computePercentChange(current: number, previous: number): number {
  if (previous === 0) {
    return current > 0 ? 100 : 0
  }
  return ((current - previous) / previous) * 100
}

/**
 * Resolve a date range preset to concrete start/end dates.
 *
 * Presets:
 * - "7 Hari": 6 days before today → today
 * - "30 Hari": 29 days before today → today
 * - "Bulan Ini": first of current month → today
 * - "Tahun Ini": January 1 of current year → today
 *
 * endDate is always `today`.
 */
export function getPresetRange(
  preset: string,
  today: Date
): { startDate: Date; endDate: Date } {
  const endDate = new Date(today.getFullYear(), today.getMonth(), today.getDate())

  let startDate: Date

  switch (preset as DateRangePreset) {
    case "7 Hari":
      startDate = new Date(endDate)
      startDate.setDate(startDate.getDate() - 6)
      break
    case "30 Hari":
      startDate = new Date(endDate)
      startDate.setDate(startDate.getDate() - 29)
      break
    case "Bulan Ini":
      startDate = new Date(endDate.getFullYear(), endDate.getMonth(), 1)
      break
    case "Tahun Ini":
      startDate = new Date(endDate.getFullYear(), 0, 1)
      break
    default:
      // Default to 30 days if unknown preset
      startDate = new Date(endDate)
      startDate.setDate(startDate.getDate() - 29)
      break
  }

  return { startDate, endDate }
}

/**
 * Aggregate an array of daily statistics by the given granularity.
 *
 * - "daily": pass through as-is (one data point per day)
 * - "weekly": group by ISO week number and year, sum counts
 * - "monthly": group by calendar month, sum counts
 *
 * Returns data sorted by date ascending.
 */
export function aggregateByGranularity(
  data: DailyStat[],
  granularity: Granularity
): ChartDataPoint[] {
  if (data.length === 0) {
    return []
  }

  if (granularity === "daily") {
    return data.map((d) => ({
      date: d.date,
      visitorCount: d.visitorCount,
      loanCount: d.loanCount,
      returnCount: d.returnCount,
    }))
  }

  const grouped = new Map<string, ChartDataPoint>()

  for (const row of data) {
    const key = getGroupKey(row.date, granularity)

    const existing = grouped.get(key)
    if (existing) {
      existing.visitorCount += row.visitorCount
      existing.loanCount += row.loanCount
      existing.returnCount += row.returnCount
    } else {
      grouped.set(key, {
        date: getGroupDate(row.date, granularity),
        visitorCount: row.visitorCount,
        loanCount: row.loanCount,
        returnCount: row.returnCount,
      })
    }
  }

  return Array.from(grouped.values()).sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
  )
}

/**
 * Get the grouping key for a date based on granularity.
 */
function getGroupKey(dateStr: string, granularity: Granularity): string {
  const date = new Date(dateStr)

  if (granularity === "weekly") {
    // ISO week: get the Monday of the week
    const monday = getISOWeekMonday(date)
    return monday.toISOString().slice(0, 10)
  }

  // monthly
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`
}

/**
 * Get the representative date string for a group.
 */
function getGroupDate(dateStr: string, granularity: Granularity): string {
  const date = new Date(dateStr)

  if (granularity === "weekly") {
    // Use the Monday of the ISO week as the representative date
    const monday = getISOWeekMonday(date)
    return monday.toISOString().slice(0, 10)
  }

  // monthly: use first day of the month
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  return `${year}-${month}-01`
}

/**
 * Get the Monday of the ISO week for a given date.
 * ISO weeks start on Monday.
 */
function getISOWeekMonday(date: Date): Date {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const day = d.getUTCDay()
  // ISO: Monday=1, Sunday=7. Shift so Monday is 0.
  const diff = day === 0 ? -6 : 1 - day
  d.setUTCDate(d.getUTCDate() + diff)
  return d
}
