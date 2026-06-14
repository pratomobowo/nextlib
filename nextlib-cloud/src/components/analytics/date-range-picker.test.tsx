// @vitest-environment jsdom
import { render, screen, fireEvent } from "@testing-library/react"
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { DateRangePicker } from "./date-range-picker"

// Mock the calendar/popover to avoid complex DOM rendering in jsdom
vi.mock("@/components/ui/calendar", () => ({
  Calendar: () => <div data-testid="mock-calendar" />,
}))

vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PopoverTrigger: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="popover-trigger">{children}</div>
  ),
  PopoverContent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="popover-content">{children}</div>
  ),
}))

describe("DateRangePicker", () => {
  const today = new Date(2024, 5, 15) // June 15, 2024
  const defaultStart = new Date(2024, 4, 17) // May 17, 2024 (30 Hari back)
  const defaultEnd = today
  let onRangeChange: ReturnType<typeof vi.fn>

  beforeEach(() => {
    onRangeChange = vi.fn()
    vi.useFakeTimers()
    vi.setSystemTime(today)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("renders all preset buttons", () => {
    render(
      <DateRangePicker
        startDate={defaultStart}
        endDate={defaultEnd}
        onRangeChange={onRangeChange}
      />
    )

    expect(screen.getByRole("button", { name: "7 Hari" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "30 Hari" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Bulan Ini" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Tahun Ini" })).toBeInTheDocument()
  })

  it("defaults to '30 Hari' as the active preset on initial render", () => {
    render(
      <DateRangePicker
        startDate={defaultStart}
        endDate={defaultEnd}
        onRangeChange={onRangeChange}
      />
    )

    const button30Hari = screen.getByRole("button", { name: "30 Hari" })
    expect(button30Hari).toHaveAttribute("aria-pressed", "true")

    // Other presets should not be active
    expect(screen.getByRole("button", { name: "7 Hari" })).toHaveAttribute(
      "aria-pressed",
      "false"
    )
    expect(screen.getByRole("button", { name: "Bulan Ini" })).toHaveAttribute(
      "aria-pressed",
      "false"
    )
    expect(screen.getByRole("button", { name: "Tahun Ini" })).toHaveAttribute(
      "aria-pressed",
      "false"
    )
  })

  it("changes active preset when a different preset button is clicked", () => {
    render(
      <DateRangePicker
        startDate={defaultStart}
        endDate={defaultEnd}
        onRangeChange={onRangeChange}
      />
    )

    fireEvent.click(screen.getByRole("button", { name: "7 Hari" }))

    expect(screen.getByRole("button", { name: "7 Hari" })).toHaveAttribute(
      "aria-pressed",
      "true"
    )
    expect(screen.getByRole("button", { name: "30 Hari" })).toHaveAttribute(
      "aria-pressed",
      "false"
    )
  })

  it("calls onRangeChange with correct dates when '7 Hari' is clicked", () => {
    render(
      <DateRangePicker
        startDate={defaultStart}
        endDate={defaultEnd}
        onRangeChange={onRangeChange}
      />
    )

    fireEvent.click(screen.getByRole("button", { name: "7 Hari" }))

    expect(onRangeChange).toHaveBeenCalledTimes(1)
    const [start, end] = onRangeChange.mock.calls[0]
    // "7 Hari" means 6 days before today → today
    expect(start).toEqual(new Date(2024, 5, 9)) // June 9
    expect(end).toEqual(new Date(2024, 5, 15)) // June 15
  })

  it("calls onRangeChange with correct dates when 'Bulan Ini' is clicked", () => {
    render(
      <DateRangePicker
        startDate={defaultStart}
        endDate={defaultEnd}
        onRangeChange={onRangeChange}
      />
    )

    fireEvent.click(screen.getByRole("button", { name: "Bulan Ini" }))

    expect(onRangeChange).toHaveBeenCalledTimes(1)
    const [start, end] = onRangeChange.mock.calls[0]
    // "Bulan Ini" means first of current month → today
    expect(start).toEqual(new Date(2024, 5, 1)) // June 1
    expect(end).toEqual(new Date(2024, 5, 15)) // June 15
  })

  it("calls onRangeChange with correct dates when 'Tahun Ini' is clicked", () => {
    render(
      <DateRangePicker
        startDate={defaultStart}
        endDate={defaultEnd}
        onRangeChange={onRangeChange}
      />
    )

    fireEvent.click(screen.getByRole("button", { name: "Tahun Ini" }))

    expect(onRangeChange).toHaveBeenCalledTimes(1)
    const [start, end] = onRangeChange.mock.calls[0]
    // "Tahun Ini" means January 1 of current year → today
    expect(start).toEqual(new Date(2024, 0, 1)) // Jan 1
    expect(end).toEqual(new Date(2024, 5, 15)) // June 15
  })

  it("has a group role with accessible label for the date range selection", () => {
    render(
      <DateRangePicker
        startDate={defaultStart}
        endDate={defaultEnd}
        onRangeChange={onRangeChange}
      />
    )

    expect(
      screen.getByRole("group", { name: "Pilih rentang tanggal" })
    ).toBeInTheDocument()
  })
})
