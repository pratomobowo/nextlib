// @vitest-environment jsdom
import { render, screen } from "@testing-library/react"
import { describe, it, expect } from "vitest"
import { SummaryCard } from "./summary-card"

function TestIcon() {
  return <svg data-testid="test-icon" />
}

describe("SummaryCard", () => {
  it("renders metric title and formatted value", () => {
    render(
      <SummaryCard
        title="Total Pengunjung"
        value={12345}
        percentChange={5.2}
        icon={<TestIcon />}
      />
    )

    expect(screen.getByText("Total Pengunjung")).toBeInTheDocument()
    expect(screen.getByText("12.345")).toBeInTheDocument()
  })

  it("renders icon prop", () => {
    render(
      <SummaryCard
        title="Total Pengunjung"
        value={100}
        percentChange={0}
        icon={<TestIcon />}
      />
    )

    expect(screen.getByTestId("test-icon")).toBeInTheDocument()
  })

  it("renders green percentage badge with upward arrow for positive change", () => {
    const { container } = render(
      <SummaryCard
        title="Total Peminjaman"
        value={500}
        percentChange={12.5}
        icon={<TestIcon />}
      />
    )

    const badge = container.querySelector(".text-green-600")
    expect(badge).toBeInTheDocument()
    expect(badge).toHaveTextContent("12.5%")
  })

  it("renders red percentage badge with downward arrow for negative change", () => {
    const { container } = render(
      <SummaryCard
        title="Total Pengembalian"
        value={300}
        percentChange={-3.2}
        icon={<TestIcon />}
      />
    )

    const badge = container.querySelector(".text-red-600")
    expect(badge).toBeInTheDocument()
    expect(badge).toHaveTextContent("3.2%")
  })

  it("renders neutral percentage badge without arrow for zero change", () => {
    render(
      <SummaryCard
        title="Total Pengunjung"
        value={200}
        percentChange={0}
        icon={<TestIcon />}
      />
    )

    expect(screen.getByText("0%")).toBeInTheDocument()
    // No arrow icons should be present in the percentage badge
    const badge = screen.getByText("0%")
    expect(badge.querySelector("svg")).toBeNull()
  })

  it("includes aria-label with metric name, value, and change direction", () => {
    render(
      <SummaryCard
        title="Total Pengunjung"
        value={1500}
        percentChange={8.3}
        icon={<TestIcon />}
      />
    )

    const card = screen.getByLabelText("Total Pengunjung: 1.500, 8.3% naik")
    expect(card).toBeInTheDocument()
  })

  it("includes aria-label with 'turun' for negative change", () => {
    render(
      <SummaryCard
        title="Total Peminjaman"
        value={250}
        percentChange={-4.7}
        icon={<TestIcon />}
      />
    )

    const card = screen.getByLabelText("Total Peminjaman: 250, 4.7% turun")
    expect(card).toBeInTheDocument()
  })

  it("includes aria-label with 'tidak berubah' for zero change", () => {
    render(
      <SummaryCard
        title="Total Pengembalian"
        value={100}
        percentChange={0}
        icon={<TestIcon />}
      />
    )

    const card = screen.getByLabelText("Total Pengembalian: 100, 0.0% tidak berubah")
    expect(card).toBeInTheDocument()
  })
})
