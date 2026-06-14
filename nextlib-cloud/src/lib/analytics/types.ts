/**
 * Shared TypeScript interfaces for the Dashboard Analytics feature.
 */

/** Granularity levels for chart data aggregation */
export type Granularity = "daily" | "weekly" | "monthly"

/** A single data point rendered in the analytics chart */
export interface ChartDataPoint {
  date: string
  visitorCount: number
  loanCount: number
  returnCount: number
}

/** Full response shape from GET /api/v1/analytics/stats */
export interface StatsApiResponse {
  data: ChartDataPoint[]
  summary: {
    visitors: { total: number; percentChange: number }
    loans: { total: number; percentChange: number }
    returns: { total: number; percentChange: number }
  }
  meta: {
    startDate: string
    endDate: string
    granularity: string
    tenantId: string
  }
}

/** Error response shape from the Stats API */
export interface StatsApiError {
  error: true
  code: string
  message: string
}

/** Input shape for aggregation — matches the daily_stats row structure */
export interface DailyStat {
  date: string
  visitorCount: number
  loanCount: number
  returnCount: number
}

/** Preset identifiers for date range selection */
export type DateRangePreset = "7 Hari" | "30 Hari" | "Bulan Ini" | "Tahun Ini"
