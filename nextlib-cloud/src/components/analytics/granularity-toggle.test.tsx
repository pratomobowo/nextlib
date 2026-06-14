// @vitest-environment jsdom
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, it, expect, vi } from "vitest"
import { GranularityToggle } from "./granularity-toggle"

describe("GranularityToggle", () => {
  it("renders three toggle buttons with correct labels", () => {
    render(<GranularityToggle value="daily" onChange={() => {}} />)

    expect(screen.getByRole("button", { name: "Harian" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Mingguan" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Bulanan" })).toBeInTheDocument()
  })

  it("sets aria-pressed=true on the active granularity", () => {
    render(<GranularityToggle value="weekly" onChange={() => {}} />)

    expect(screen.getByRole("button", { name: "Harian" })).toHaveAttribute("aria-pressed", "false")
    expect(screen.getByRole("button", { name: "Mingguan" })).toHaveAttribute("aria-pressed", "true")
    expect(screen.getByRole("button", { name: "Bulanan" })).toHaveAttribute("aria-pressed", "false")
  })

  it("disables Bulanan button when disableMonthly is true", () => {
    render(<GranularityToggle value="daily" onChange={() => {}} disableMonthly />)

    expect(screen.getByRole("button", { name: "Bulanan" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "Harian" })).not.toBeDisabled()
    expect(screen.getByRole("button", { name: "Mingguan" })).not.toBeDisabled()
  })

  it("does not disable Bulanan button when disableMonthly is false", () => {
    render(<GranularityToggle value="daily" onChange={() => {}} disableMonthly={false} />)

    expect(screen.getByRole("button", { name: "Bulanan" })).not.toBeDisabled()
  })

  it("calls onChange with selected granularity when a button is clicked", async () => {
    const user = userEvent.setup()
    const handleChange = vi.fn()

    render(<GranularityToggle value="daily" onChange={handleChange} />)

    await user.click(screen.getByRole("button", { name: "Mingguan" }))
    expect(handleChange).toHaveBeenCalledWith("weekly")

    await user.click(screen.getByRole("button", { name: "Bulanan" }))
    expect(handleChange).toHaveBeenCalledWith("monthly")
  })

  it("does not call onChange when disabled Bulanan is clicked", async () => {
    const user = userEvent.setup()
    const handleChange = vi.fn()

    render(<GranularityToggle value="daily" onChange={handleChange} disableMonthly />)

    await user.click(screen.getByRole("button", { name: "Bulanan" }))
    expect(handleChange).not.toHaveBeenCalled()
  })

  it("has a group role with accessible label", () => {
    render(<GranularityToggle value="daily" onChange={() => {}} />)

    expect(screen.getByRole("group", { name: "Granularitas data" })).toBeInTheDocument()
  })
})
