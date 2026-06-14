// @vitest-environment jsdom
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { describe, it, expect, vi, beforeEach } from "vitest"
import { TokenDisplay } from "./token-display"

describe("TokenDisplay", () => {
  const mockToken = "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2"
  const mockTenantName = "Test University"

  beforeEach(() => {
    vi.clearAllMocks()
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    })
  })

  it("renders the token in a monospace code block", () => {
    render(<TokenDisplay token={mockToken} tenantName={mockTenantName} />)

    const tokenElement = screen.getByLabelText("API token")
    expect(tokenElement).toBeInTheDocument()
    expect(tokenElement).toHaveTextContent(mockToken)
    expect(tokenElement.tagName).toBe("PRE")
    expect(tokenElement).toHaveClass("font-mono")
  })

  it("displays the security warning message", () => {
    render(<TokenDisplay token={mockToken} tenantName={mockTenantName} />)

    expect(
      screen.getByText(/this token will only be shown once/i)
    ).toBeInTheDocument()
  })

  it("displays the card title and description", () => {
    render(<TokenDisplay token={mockToken} tenantName={mockTenantName} />)

    expect(screen.getByText("API Token Generated")).toBeInTheDocument()
    expect(
      screen.getByText(/your nextlib agent token has been created successfully/i)
    ).toBeInTheDocument()
  })

  it("copies token to clipboard when copy button is clicked", async () => {
    render(<TokenDisplay token={mockToken} tenantName={mockTenantName} />)

    const copyButton = screen.getByRole("button", { name: /^copy token$/i })
    fireEvent.click(copyButton)

    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(mockToken)
    })
  })

  it("shows 'Copied' feedback after copy", async () => {
    render(<TokenDisplay token={mockToken} tenantName={mockTenantName} />)

    const copyButton = screen.getByRole("button", { name: /^copy token$/i })
    fireEvent.click(copyButton)

    await waitFor(() => {
      expect(screen.getByText("Copied to clipboard")).toBeInTheDocument()
    })
  })

  it("renders the download button", () => {
    render(<TokenDisplay token={mockToken} tenantName={mockTenantName} />)

    expect(
      screen.getByRole("button", { name: /download token as text file/i })
    ).toBeInTheDocument()
  })

  it("triggers file download when download button is clicked", () => {
    const createObjectURL = vi.fn().mockReturnValue("blob:test-url")
    const revokeObjectURL = vi.fn()
    Object.assign(URL, { createObjectURL, revokeObjectURL })

    const clickSpy = vi.fn()
    const appendChildSpy = vi.spyOn(document.body, "appendChild")
    const removeChildSpy = vi.spyOn(document.body, "removeChild")

    render(<TokenDisplay token={mockToken} tenantName={mockTenantName} />)

    // Mock the anchor element behavior
    const originalCreateElement = document.createElement.bind(document)
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const element = originalCreateElement(tag)
      if (tag === "a") {
        element.click = clickSpy
      }
      return element
    })

    const downloadButton = screen.getByRole("button", {
      name: /download token as text file/i,
    })
    fireEvent.click(downloadButton)

    expect(createObjectURL).toHaveBeenCalled()
    expect(clickSpy).toHaveBeenCalled()
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:test-url")

    appendChildSpy.mockRestore()
    removeChildSpy.mockRestore()
  })

  it("has proper aria-labels for accessibility", () => {
    render(<TokenDisplay token={mockToken} tenantName={mockTenantName} />)

    expect(screen.getByLabelText("API token")).toBeInTheDocument()
    expect(screen.getByRole("alert")).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: /^copy token$/i })
    ).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: /copy token to clipboard/i })
    ).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: /download token as text file/i })
    ).toBeInTheDocument()
  })

  it("works without tenantName prop", () => {
    render(<TokenDisplay token={mockToken} />)

    expect(screen.getByLabelText("API token")).toHaveTextContent(mockToken)
  })
})
