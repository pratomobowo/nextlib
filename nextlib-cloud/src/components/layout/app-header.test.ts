import { describe, it, expect } from 'vitest'

// Test the formatSegment utility logic used in app-header breadcrumb
function formatSegment(segment: string): string {
  return segment
    .replace(/-/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

function buildBreadcrumbItems(pathname: string) {
  const segments = pathname.split("/").filter(Boolean)
  return [
    { label: "Home", href: "/" },
    ...segments.map((segment, index) => ({
      label: formatSegment(segment),
      href: "/" + segments.slice(0, index + 1).join("/"),
    })),
  ]
}

describe("AppHeader breadcrumb logic", () => {
  describe("formatSegment", () => {
    it("capitalizes a single word", () => {
      expect(formatSegment("tenants")).toBe("Tenants")
    })

    it("replaces hyphens with spaces and capitalizes each word", () => {
      expect(formatSegment("search-book")).toBe("Search Book")
    })

    it("handles single character segments", () => {
      expect(formatSegment("a")).toBe("A")
    })

    it("handles already capitalized segments", () => {
      expect(formatSegment("Dashboard")).toBe("Dashboard")
    })
  })

  describe("buildBreadcrumbItems", () => {
    it("returns only Home for root path", () => {
      const items = buildBreadcrumbItems("/")
      expect(items).toEqual([{ label: "Home", href: "/" }])
    })

    it("generates correct breadcrumb for /tenants", () => {
      const items = buildBreadcrumbItems("/tenants")
      expect(items).toEqual([
        { label: "Home", href: "/" },
        { label: "Tenants", href: "/tenants" },
      ])
    })

    it("generates correct breadcrumb for /tenants/new", () => {
      const items = buildBreadcrumbItems("/tenants/new")
      expect(items).toEqual([
        { label: "Home", href: "/" },
        { label: "Tenants", href: "/tenants" },
        { label: "New", href: "/tenants/new" },
      ])
    })

    it("handles hyphenated segments in deep paths", () => {
      const items = buildBreadcrumbItems("/settings/connection-status")
      expect(items).toEqual([
        { label: "Home", href: "/" },
        { label: "Settings", href: "/settings" },
        { label: "Connection Status", href: "/settings/connection-status" },
      ])
    })
  })
})
