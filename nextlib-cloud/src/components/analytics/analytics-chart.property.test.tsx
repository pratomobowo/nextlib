// @vitest-environment jsdom
import { render } from "@testing-library/react"
import { describe, it, expect, vi } from "vitest"
import fc from "fast-check"
import { AnalyticsChart } from "./analytics-chart"
import type { ChartDataPoint } from "@/lib/analytics/types"

// Mock Recharts components since they don't render in jsdom
vi.mock("recharts", () => ({
  AreaChart: ({ children }: any) => <div data-testid="area-chart">{children}</div>,
  Area: () => <div />,
  XAxis: () => <div />,
  YAxis: () => <div />,
  CartesianGrid: () => <div />,
  Tooltip: () => <div />,
  ResponsiveContainer: ({ children }: any) => <div>{children}</div>,
}))

// Feature: dashboard-analytics, Property 7: Accessible data table mirrors chart data
/**
 * Property 7: Accessible data table mirrors chart data
 *
 * For any non-empty chart data array, the rendered hidden data table SHALL contain
 * exactly the same number of rows as data points, and each row SHALL contain the
 * date and all three metric values matching the corresponding data point.
 *
 * **Validates: Requirements 10.2**
 */
describe("Property 7: Accessible data table mirrors chart data", () => {
  // Generator for a valid ISO date string
  const arbDate = fc
    .date({ min: new Date("2020-01-01"), max: new Date("2025-12-31"), noInvalidDate: true })
    .map((d) => d.toISOString().slice(0, 10))

  // Generator for a single ChartDataPoint
  const arbChartDataPoint: fc.Arbitrary<ChartDataPoint> = fc.record({
    date: arbDate,
    visitorCount: fc.nat({ max: 100000 }),
    loanCount: fc.nat({ max: 100000 }),
    returnCount: fc.nat({ max: 100000 }),
  })

  // Generator for a non-empty array of ChartDataPoints (1–100 points)
  const arbChartData = fc.array(arbChartDataPoint, { minLength: 1, maxLength: 100 })

  it("hidden table row count matches data points count", () => {
    fc.assert(
      fc.property(arbChartData, (data) => {
        const { container } = render(
          <AnalyticsChart data={data} isLoading={false} />
        )

        const table = container.querySelector('table[aria-label="Data tren aktivitas perpustakaan"]')
        expect(table).not.toBeNull()

        const rows = table!.querySelectorAll("tbody tr")
        expect(rows.length).toBe(data.length)
      }),
      { numRuns: 100 }
    )
  })

  it("each table row contains date and all three metric values matching the data point", () => {
    fc.assert(
      fc.property(arbChartData, (data) => {
        const { container } = render(
          <AnalyticsChart data={data} isLoading={false} />
        )

        const table = container.querySelector('table[aria-label="Data tren aktivitas perpustakaan"]')
        expect(table).not.toBeNull()

        const rows = table!.querySelectorAll("tbody tr")

        data.forEach((point, index) => {
          const cells = rows[index].querySelectorAll("td")
          expect(cells.length).toBe(4)
          expect(cells[0].textContent).toBe(point.date)
          expect(cells[1].textContent).toBe(String(point.visitorCount))
          expect(cells[2].textContent).toBe(String(point.loanCount))
          expect(cells[3].textContent).toBe(String(point.returnCount))
        })
      }),
      { numRuns: 100 }
    )
  })
})
