// @vitest-environment jsdom
import * as React from "react"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, it, expect, vi } from "vitest"
import { TenantSelector } from "./tenant-selector"

const SelectContext = React.createContext<{
  value?: string
  onValueChange?: (val: string) => void
  items?: { value: string; label: string }[]
  open?: boolean
  setOpen?: (open: boolean) => void
}>({})

vi.mock("@/components/ui/select", () => {
  return {
    Select: ({ value, onValueChange, items, children }: any) => {
      const [open, setOpen] = React.useState(false)
      return (
        <SelectContext.Provider value={{ value, onValueChange, items, open, setOpen }}>
          <div data-testid="select-root">{children}</div>
        </SelectContext.Provider>
      )
    },
    SelectTrigger: ({ children, "aria-label": ariaLabel }: any) => {
      const { open, setOpen } = React.useContext(SelectContext)
      return (
        <button
          aria-label={ariaLabel}
          aria-expanded={open}
          onClick={() => setOpen?.(!open)}
        >
          {children}
        </button>
      )
    },
    SelectValue: ({ placeholder }: any) => {
      const { value, items } = React.useContext(SelectContext)
      const selectedItem = items?.find((item) => item.value === value)
      return <span>{selectedItem ? selectedItem.label : placeholder}</span>
    },
    SelectContent: ({ children }: any) => {
      const { open } = React.useContext(SelectContext)
      if (!open) return null
      return <div>{children}</div>
    },
    SelectItem: ({ value: itemValue, children }: any) => {
      const { value, onValueChange, setOpen } = React.useContext(SelectContext)
      return (
        <button
          role="option"
          aria-selected={value === itemValue}
          onClick={() => {
            onValueChange?.(itemValue)
            setOpen?.(false)
          }}
        >
          {children}
        </button>
      )
    },
  }
})

const MOCK_TENANTS = [
  { id: "t-1", name: "Perpustakaan USBYPKP" },
  { id: "t-2", name: "Perpustakaan UNPAD" },
  { id: "t-3", name: "Perpustakaan ITB" },
]

describe("TenantSelector", () => {
  it("renders the select trigger with tenant name", () => {
    render(
      <TenantSelector
        tenants={MOCK_TENANTS}
        selectedId="t-1"
        onChange={() => {}}
      />
    )

    expect(screen.getByText("Perpustakaan USBYPKP")).toBeInTheDocument()
  })

  it("renders the select trigger with aria-label", () => {
    render(
      <TenantSelector
        tenants={MOCK_TENANTS}
        selectedId="t-2"
        onChange={() => {}}
      />
    )

    expect(screen.getByLabelText("Pilih tenant")).toBeInTheDocument()
  })

  it("displays all tenant options when opened", async () => {
    const user = userEvent.setup()

    render(
      <TenantSelector
        tenants={MOCK_TENANTS}
        selectedId="t-1"
        onChange={() => {}}
      />
    )

    await user.click(screen.getByLabelText("Pilih tenant"))

    const options = screen.getAllByRole("option")
    expect(options).toHaveLength(3)
    expect(options[0]).toHaveTextContent("Perpustakaan USBYPKP")
    expect(options[1]).toHaveTextContent("Perpustakaan UNPAD")
    expect(options[2]).toHaveTextContent("Perpustakaan ITB")
  })

  it("calls onChange with selected tenant ID when a different option is selected", async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(
      <TenantSelector
        tenants={MOCK_TENANTS}
        selectedId="t-1"
        onChange={onChange}
      />
    )

    await user.click(screen.getByLabelText("Pilih tenant"))
    await user.click(screen.getByText("Perpustakaan UNPAD"))

    expect(onChange).toHaveBeenCalledWith("t-2")
  })
})
