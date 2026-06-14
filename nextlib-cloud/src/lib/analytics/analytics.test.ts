import { describe, it, expect } from "vitest"
import {
  computePercentChange,
  getPresetRange,
  aggregateByGranularity,
} from "./index"
import type { DailyStat } from "./types"

describe("computePercentChange", () => {
  it("returns correct percentage for positive change", () => {
    expect(computePercentChange(150, 100)).toBe(50)
  })

  it("returns correct percentage for negative change", () => {
    expect(computePercentChange(80, 100)).toBe(-20)
  })

  it("returns 0 when both values are zero", () => {
    expect(computePercentChange(0, 0)).toBe(0)
  })

  it("returns 100 when previous is zero and current is positive", () => {
    expect(computePercentChange(50, 0)).toBe(100)
  })

  it("returns -100 when current drops to zero from positive", () => {
    expect(computePercentChange(0, 100)).toBe(-100)
  })
})

describe("getPresetRange", () => {
  const today = new Date(2024, 5, 15) // June 15, 2024

  it("returns 7 days range (6 days before today)", () => {
    const { startDate, endDate } = getPresetRange("7 Hari", today)
    expect(startDate).toEqual(new Date(2024, 5, 9))
    expect(endDate).toEqual(new Date(2024, 5, 15))
  })

  it("returns 30 days range (29 days before today)", () => {
    const { startDate, endDate } = getPresetRange("30 Hari", today)
    expect(startDate).toEqual(new Date(2024, 4, 17))
    expect(endDate).toEqual(new Date(2024, 5, 15))
  })

  it("returns current month range", () => {
    const { startDate, endDate } = getPresetRange("Bulan Ini", today)
    expect(startDate).toEqual(new Date(2024, 5, 1))
    expect(endDate).toEqual(new Date(2024, 5, 15))
  })

  it("returns current year range", () => {
    const { startDate, endDate } = getPresetRange("Tahun Ini", today)
    expect(startDate).toEqual(new Date(2024, 0, 1))
    expect(endDate).toEqual(new Date(2024, 5, 15))
  })

  it("endDate is always today", () => {
    const presets = ["7 Hari", "30 Hari", "Bulan Ini", "Tahun Ini"]
    for (const preset of presets) {
      const { endDate } = getPresetRange(preset, today)
      expect(endDate).toEqual(new Date(2024, 5, 15))
    }
  })
})

describe("aggregateByGranularity", () => {
  const dailyData: DailyStat[] = [
    { date: "2024-06-03", visitorCount: 10, loanCount: 5, returnCount: 3 },
    { date: "2024-06-04", visitorCount: 12, loanCount: 7, returnCount: 4 },
    { date: "2024-06-05", visitorCount: 8, loanCount: 3, returnCount: 2 },
    { date: "2024-06-10", visitorCount: 15, loanCount: 9, returnCount: 6 },
    { date: "2024-06-11", visitorCount: 20, loanCount: 11, returnCount: 8 },
    { date: "2024-06-17", visitorCount: 25, loanCount: 14, returnCount: 10 },
  ]

  it("returns data as-is for daily granularity", () => {
    const result = aggregateByGranularity(dailyData, "daily")
    expect(result).toHaveLength(6)
    expect(result[0]).toEqual({
      date: "2024-06-03",
      visitorCount: 10,
      loanCount: 5,
      returnCount: 3,
    })
  })

  it("groups by ISO week for weekly granularity", () => {
    const result = aggregateByGranularity(dailyData, "weekly")
    // 2024-06-03 (Mon) to 2024-06-05 (Wed) = week of June 3
    // 2024-06-10 (Mon) to 2024-06-11 (Tue) = week of June 10
    // 2024-06-17 (Mon) = week of June 17
    expect(result).toHaveLength(3)
    expect(result[0].visitorCount).toBe(30) // 10+12+8
    expect(result[0].loanCount).toBe(15) // 5+7+3
    expect(result[0].returnCount).toBe(9) // 3+4+2
  })

  it("groups by calendar month for monthly granularity", () => {
    const result = aggregateByGranularity(dailyData, "monthly")
    expect(result).toHaveLength(1)
    expect(result[0].visitorCount).toBe(90) // sum of all
    expect(result[0].loanCount).toBe(49)
    expect(result[0].returnCount).toBe(33)
    expect(result[0].date).toBe("2024-06-01")
  })

  it("returns empty array for empty input", () => {
    const result = aggregateByGranularity([], "daily")
    expect(result).toHaveLength(0)
  })

  it("conserves totals across aggregation levels", () => {
    const dailyResult = aggregateByGranularity(dailyData, "daily")
    const weeklyResult = aggregateByGranularity(dailyData, "weekly")
    const monthlyResult = aggregateByGranularity(dailyData, "monthly")

    const sumVisitors = (data: { visitorCount: number }[]) =>
      data.reduce((sum, d) => sum + d.visitorCount, 0)

    expect(sumVisitors(dailyResult)).toBe(sumVisitors(weeklyResult))
    expect(sumVisitors(weeklyResult)).toBe(sumVisitors(monthlyResult))
  })
})
