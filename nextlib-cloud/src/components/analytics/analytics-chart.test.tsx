// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react"
import { describe, it, expect, vi } from "vitest"
import { AnalyticsChart } from "./analytics-chart"
import type { ChartDataPoint } from "@/lib/analytics/types"

// Mock recharts to avoid SVG rendering issues in jsdom
vi.mock("recharts", () => {
  const MockResponsiveContainer = ({
    children,
    minHeight,
  }: {
    children: React.ReactNode
    minHeight?: number
  }) => (
    <div data-testid="responsive-container" style={{ minHeight }}>
      {children}
    </div>
  )
  const MockAreaChart = ({ children }: { children: React.ReactNode }) => (
    <div data-testid="area-chart">{children}</div>
  )
  const MockArea = ({ dataKey, stroke }: { dataKey: string; stroke: string }) => (
    <div data-testid={`area-${dataKey}`} data-stroke={stroke} />
  )
  const MockXAxis = () => <div data-testid="x-axis" />
  const MockYAxis = () => <div data-testid="y-axis" />
  const MockCartesianGrid = () => <div data-testid="cartesian-grid" />
  const MockTooltip = () => <div data-testid="tooltip" />

  return {
    ResponsiveContainer: MockResponsiveContainer,
    AreaChart: MockAreaChart,
    Area: MockArea,
    XAxis: MockXAxis,
    YAxis: MockYAxis,
    CartesianGrid: MockCartesianGrid,
    Tooltip: MockTooltip,
  }
})

const sampleData: ChartDataPoint[] = [
  { date: "2024-06-01", visitorCount: 120, loanCount: 45, returnCount: 30 },
  { date: "2024-06-02", visitorCount: 150, loanCount: 60, returnCount: 40 },
  { date: "2024-06-03", visitorCount: 90, loanCount: 30, returnCount: 25 },
]

describe("AnalyticsChart", () => {
  describe("loading state", () => {
    it("renders skeleton when isLoading is true", () => {
      render(<AnalyticsChart data={[]} isLoading={true} />)

      const skeleton = screen.getByRole("status", { name: "Memuat grafik" })
      expect(skeleton).toBeInTheDocument()
      expect(skeleton).toHaveClass("animate-pulse")
    })

    it("does not render chart when isLoading is true", () => {
      render(<AnalyticsChart data={sampleData} isLoading={true} />)

      expect(screen.queryByTestId("area-chart")).not.toBeInTheDocument()
    })
  })

  describe("empty state", () => {
    it("renders empty state message when data is empty and not loading", () => {
      render(<AnalyticsChart data={[]} isLoading={false} />)

      expect(
        screen.getByText("Belum ada data untuk periode ini")
      ).toBeInTheDocument()
    })

    it("does not render chart when data is empty", () => {
      render(<AnalyticsChart data={[]} isLoading={false} />)

      expect(screen.queryByTestId("area-chart")).not.toBeInTheDocument()
    })
  })

  describe("chart rendering", () => {
    it("renders AreaChart with ResponsiveContainer when data is provided", () => {
      render(<AnalyticsChart data={sampleData} isLoading={false} />)

      expect(screen.getByTestId("responsive-container")).toBeInTheDocument()
      expect(screen.getByTestId("area-chart")).toBeInTheDocument()
    })

    it("renders three Area series with correct colors (blue-500, green-500, amber-500)", () => {
      render(<AnalyticsChart data={sampleData} isLoading={false} />)

      const visitors = screen.getByTestId("area-visitorCount")
      const loans = screen.getByTestId("area-loanCount")
      const returns = screen.getByTestId("area-returnCount")

      expect(visitors).toHaveAttribute("data-stroke", "#3b82f6")
      expect(loans).toHaveAttribute("data-stroke", "#22c55e")
      expect(returns).toHaveAttribute("data-stroke", "#f59e0b")
    })

    it("renders ResponsiveContainer with minHeight 300px", () => {
      render(<AnalyticsChart data={sampleData} isLoading={false} />)

      const container = screen.getByTestId("responsive-container")
      expect(container).toHaveStyle({ minHeight: "300px" })
    })
  })

  describe("accessible data table", () => {
    it("renders a hidden data table for screen readers", () => {
      render(<AnalyticsChart data={sampleData} isLoading={false} />)

      const table = screen.getByRole("table", {
        name: "Data tren aktivitas perpustakaan",
      })
      expect(table).toBeInTheDocument()
      expect(table).toHaveClass("sr-only")
    })

    it("renders correct number of data rows", () => {
      render(<AnalyticsChart data={sampleData} isLoading={false} />)

      const table = screen.getByRole("table")
      const rows = within(table).getAllByRole("row")
      // 1 header row + 3 data rows
      expect(rows).toHaveLength(4)
    })

    it("renders table headers for all columns", () => {
      render(<AnalyticsChart data={sampleData} isLoading={false} />)

      expect(screen.getByRole("columnheader", { name: "Tanggal" })).toBeInTheDocument()
      expect(screen.getByRole("columnheader", { name: "Pengunjung" })).toBeInTheDocument()
      expect(screen.getByRole("columnheader", { name: "Peminjaman" })).toBeInTheDocument()
      expect(screen.getByRole("columnheader", { name: "Pengembalian" })).toBeInTheDocument()
    })

    it("renders data values matching the data points", () => {
      render(<AnalyticsChart data={sampleData} isLoading={false} />)

      const table = screen.getByRole("table")
      const rows = within(table).getAllByRole("row")

      // Check second row (first data row)
      const firstDataRow = rows[1]
      const cells = within(firstDataRow).getAllByRole("cell")
      expect(cells[0]).toHaveTextContent("2024-06-01")
      expect(cells[1]).toHaveTextContent("120")
      expect(cells[2]).toHaveTextContent("45")
      expect(cells[3]).toHaveTextContent("30")
    })

    it("does not render data table when data is empty", () => {
      render(<AnalyticsChart data={[]} isLoading={false} />)

      expect(screen.queryByRole("table")).not.toBeInTheDocument()
    })

    it("does not render data table when loading", () => {
      render(<AnalyticsChart data={sampleData} isLoading={true} />)

      expect(screen.queryByRole("table")).not.toBeInTheDocument()
    })
  })
})
