// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { AnalyticsPanel } from "./analytics-panel"

// Mock next/navigation
const mockPush = vi.fn()
const mockSearchParams = new URLSearchParams()

vi.mock("next/navigation", () => ({
  useSearchParams: () => mockSearchParams,
  useRouter: () => ({ push: mockPush }),
}))

// Mock fetch
const mockFetch = vi.fn()

beforeEach(() => {
  mockFetch.mockReset()
  mockPush.mockReset()
  global.fetch = mockFetch
})

afterEach(() => {
  vi.restoreAllMocks()
})

const mockStatsResponse = {
  data: [
    { date: "2024-06-01", visitorCount: 10, loanCount: 5, returnCount: 3 },
    { date: "2024-06-02", visitorCount: 15, loanCount: 8, returnCount: 4 },
  ],
  summary: {
    visitors: { total: 25, percentChange: 12.5 },
    loans: { total: 13, percentChange: -5.0 },
    returns: { total: 7, percentChange: 0 },
  },
  meta: {
    startDate: "2024-06-01",
    endDate: "2024-06-30",
    granularity: "daily",
    tenantId: "tenant-1",
  },
}

describe("AnalyticsPanel", () => {
  it("shows loading skeletons while fetching data", () => {
    mockFetch.mockReturnValue(new Promise(() => {})) // never resolves

    render(<AnalyticsPanel tenants={[{ id: "t1", name: "Campus A" }]} />)

    // Skeleton cards should be present
    const skeletons = screen.getAllByTestId
    // The loading skeleton for the chart should show
    expect(screen.getByRole("status", { name: "Memuat grafik" })).toBeInTheDocument()
  })

  it("renders summary cards after successful data fetch", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockStatsResponse),
    })

    render(<AnalyticsPanel tenants={[{ id: "t1", name: "Campus A" }]} />)

    await waitFor(() => {
      expect(screen.getByText("Total Pengunjung")).toBeInTheDocument()
    })

    expect(screen.getByText("Total Peminjaman")).toBeInTheDocument()
    expect(screen.getByText("Total Pengembalian")).toBeInTheDocument()
  })

  it("displays error message with retry button on fetch failure", async () => {
    mockFetch.mockRejectedValue(new Error("Network error"))

    render(<AnalyticsPanel tenants={[{ id: "t1", name: "Campus A" }]} />)

    await waitFor(() => {
      expect(
        screen.getByText("Terjadi kesalahan saat memuat data")
      ).toBeInTheDocument()
    })

    expect(screen.getByRole("button", { name: "Coba Lagi" })).toBeInTheDocument()
  })

  it("retries data fetch when retry button is clicked", async () => {
    const user = userEvent.setup()

    // First call fails
    mockFetch.mockRejectedValueOnce(new Error("Network error"))

    render(<AnalyticsPanel tenants={[{ id: "t1", name: "Campus A" }]} />)

    await waitFor(() => {
      expect(
        screen.getByText("Terjadi kesalahan saat memuat data")
      ).toBeInTheDocument()
    })

    // Second call succeeds
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockStatsResponse),
    })

    await user.click(screen.getByRole("button", { name: "Coba Lagi" }))

    await waitFor(() => {
      expect(screen.getByText("Total Pengunjung")).toBeInTheDocument()
    })
  })

  it("renders TenantSelector when tenants prop is provided", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockStatsResponse),
    })

    render(
      <AnalyticsPanel
        tenants={[
          { id: "t1", name: "Campus A" },
          { id: "t2", name: "Campus B" },
        ]}
      />
    )

    expect(screen.getByLabelText("Pilih tenant")).toBeInTheDocument()
  })

  it("does not render TenantSelector when tenants prop is not provided", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockStatsResponse),
    })

    render(<AnalyticsPanel />)

    expect(screen.queryByLabelText("Pilih tenant")).not.toBeInTheDocument()
  })

  it("renders DateRangePicker and GranularityToggle controls", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockStatsResponse),
    })

    render(<AnalyticsPanel tenants={[{ id: "t1", name: "Campus A" }]} />)

    // DateRangePicker renders preset buttons
    expect(screen.getByRole("button", { name: "7 Hari" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "30 Hari" })).toBeInTheDocument()

    // GranularityToggle
    expect(screen.getByRole("button", { name: "Harian" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Mingguan" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Bulanan" })).toBeInTheDocument()
  })

  it("fetches data with correct query parameters", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockStatsResponse),
    })

    render(<AnalyticsPanel tenants={[{ id: "t1", name: "Campus A" }]} />)

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalled()
    })

    const fetchUrl = mockFetch.mock.calls[0][0] as string
    expect(fetchUrl).toContain("/api/v1/analytics/stats")
    expect(fetchUrl).toContain("tenant_id=t1")
    expect(fetchUrl).toContain("granularity=daily")
    expect(fetchUrl).toMatch(/start_date=\d{4}-\d{2}-\d{2}/)
    expect(fetchUrl).toMatch(/end_date=\d{4}-\d{2}-\d{2}/)
  })

  it("shows error on HTTP error response", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ error: true, code: "SERVER_ERROR", message: "Internal server error" }),
    })

    render(<AnalyticsPanel tenants={[{ id: "t1", name: "Campus A" }]} />)

    await waitFor(() => {
      expect(
        screen.getByText("Terjadi kesalahan saat memuat data")
      ).toBeInTheDocument()
    })
  })
})
