// @vitest-environment jsdom
import { render, screen } from "@testing-library/react"
import { describe, it, expect } from "vitest"
import { ConnectionStatus } from "./connection-status"

describe("ConnectionStatus", () => {
  it("renders green badge with 'Connected' text when status is connected", () => {
    render(<ConnectionStatus status="connected" />)

    const badge = screen.getByLabelText("Connection status: Connected")
    expect(badge).toBeInTheDocument()
    expect(badge).toHaveTextContent("Connected")
    expect(badge.className).toContain("bg-green-100")
  })

  it("renders red badge with 'Disconnected' text when status is disconnected", () => {
    render(<ConnectionStatus status="disconnected" />)

    const badge = screen.getByLabelText("Connection status: Disconnected")
    expect(badge).toBeInTheDocument()
    expect(badge).toHaveTextContent("Disconnected")
    expect(badge.className).toContain("bg-red-100")
  })

  it("renders amber badge with 'Pending' text when status is pending", () => {
    render(<ConnectionStatus status="pending" />)

    const badge = screen.getByLabelText("Connection status: Pending")
    expect(badge).toBeInTheDocument()
    expect(badge).toHaveTextContent("Pending")
    expect(badge.className).toContain("bg-amber-100")
  })

  it("shows alert with error message when disconnected and errorMessage is provided", () => {
    const errorMsg = "Token tidak valid atau sudah kedaluwarsa"
    render(<ConnectionStatus status="disconnected" errorMessage={errorMsg} />)

    const alert = screen.getByRole("alert")
    expect(alert).toBeInTheDocument()
    expect(alert).toHaveTextContent("Connection Error")
    expect(alert).toHaveTextContent(errorMsg)
  })

  it("does not show alert when disconnected without errorMessage", () => {
    render(<ConnectionStatus status="disconnected" />)

    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  })

  it("does not show alert when connected even if errorMessage is provided", () => {
    render(<ConnectionStatus status="connected" errorMessage="some error" />)

    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  })

  it("does not show alert when pending even if errorMessage is provided", () => {
    render(<ConnectionStatus status="pending" errorMessage="some error" />)

    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  })

  it("has proper accessible aria-label on badge", () => {
    render(<ConnectionStatus status="connected" />)

    expect(
      screen.getByLabelText("Connection status: Connected")
    ).toBeInTheDocument()
  })
})
