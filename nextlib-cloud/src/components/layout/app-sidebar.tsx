"use client"

import React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { BarChart3, BookMarked, Building2, Database, LayoutDashboard, MessageCircle, Plug, Settings, BookOpen, HelpCircle } from "lucide-react"

import { cn } from "@/lib/utils"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarFooter,
  useSidebar,
} from "@/components/ui/sidebar"

type NavItem = {
  title: string
  href: string
  icon: React.ComponentType<{ className?: string }>
  /** Which section this item belongs to — controls grouping. */
  section: "main" | "system"
}

const navItems: NavItem[] = [
  { title: "Dashboard", href: "/dashboard", icon: LayoutDashboard, section: "main" },
  { title: "Analytics", href: "/dashboard/analytics", icon: BarChart3, section: "main" },
  { title: "Data Management", href: "/data-management", icon: Database, section: "main" },
  { title: "Koneksi", href: "/koneksi", icon: Plug, section: "main" },
  { title: "Panduan", href: "/panduan", icon: HelpCircle, section: "main" },
  { title: "WhatsApp", href: "/whatsapp", icon: MessageCircle, section: "system" },
  { title: "Tenants", href: "/tenants", icon: Building2, section: "system" },
  { title: "Settings", href: "/settings", icon: Settings, section: "system" },
]

export function AppSidebar() {
  const pathname = usePathname()
  const { state } = useSidebar()
  const [user, setUser] = React.useState<{ name: string; email: string; role: string } | null>(null)

  React.useEffect(() => {
    async function loadUser() {
      try {
        const res = await fetch("/api/v1/auth/me")
        if (res.ok) {
          const data = await res.json()
          if (data.success) {
            setUser(data.data.user)
          }
        }
      } catch (error) {
        console.error("Failed to load user in sidebar:", error)
      }
    }
    loadUser()
  }, [])

  // Role-based visibility filter. Panduan is documentation — visible to all roles.
  const filteredNavItems = navItems.filter((item) => {
    if (item.href === "/panduan") return true
    if (!user) {
      if (item.href === "/tenants" || item.href === "/koneksi" || item.href === "/data-management") return false
      return true
    }
    if (user.role === "super_admin") {
      return item.href === "/dashboard" || item.href === "/tenants"
    }
    if (item.href === "/tenants") return false
    if (item.href === "/koneksi") return user.role === "tenant_admin"
    if (item.href === "/data-management") return user.role === "tenant_admin"
    return true
  })

  const mainItems = filteredNavItems.filter((i) => i.section === "main")
  const systemItems = filteredNavItems.filter((i) => i.section === "system")
  const isCollapsed = state === "collapsed"

  const initials = user
    ? user.name
        .split(" ")
        .map((n) => n[0])
        .join("")
        .substring(0, 2)
        .toUpperCase()
    : "NL"

  const roleBadgeVariant: Record<string, "default" | "secondary" | "outline"> = {
    super_admin: "default",
    tenant_admin: "secondary",
    librarian: "outline",
  }

  const roleLabel: Record<string, string> = {
    super_admin: "Super Admin",
    tenant_admin: "Tenant Admin",
    librarian: "Librarian",
  }

  return (
    <Sidebar collapsible="icon">
      {/* ─── Brand Header ─────────────────────────────────────────── */}
      <SidebarHeader className="pb-0">
        <div
          className={cn(
            "flex items-center gap-2.5 rounded-lg px-2.5 py-2.5",
            isCollapsed && "justify-center px-0"
          )}
        >
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
            <BookOpen className="size-4" />
          </div>
          {!isCollapsed && (
            <div className="flex flex-col leading-tight">
              <span className="text-sm font-bold tracking-tight">NextLib</span>
              <span className="text-[10px] text-muted-foreground">Library Platform</span>
            </div>
          )}
        </div>
      </SidebarHeader>

      {/* ─── Navigation ───────────────────────────────────────────── */}
      <SidebarContent className="gap-1 px-2 py-3">
        {mainItems.length > 0 && (
          <SidebarGroup className="py-0">
            {!isCollapsed && <SidebarGroupLabel className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">Menu Utama</SidebarGroupLabel>}
            <SidebarGroupContent>
              <SidebarMenu className="gap-1">
                {mainItems.map((item) => (
                  <SidebarNavItem
                    key={item.href}
                    item={item}
                    pathname={pathname}
                    isCollapsed={isCollapsed}
                  />
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {systemItems.length > 0 && (
          <SidebarGroup className="py-0 mt-3">
            {!isCollapsed && <SidebarGroupLabel className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">Sistem</SidebarGroupLabel>}
            <SidebarGroupContent>
              <SidebarMenu className="gap-1">
                {systemItems.map((item) => (
                  <SidebarNavItem
                    key={item.href}
                    item={item}
                    pathname={pathname}
                    isCollapsed={isCollapsed}
                  />
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      {/* ─── User Footer ──────────────────────────────────────────── */}
      <SidebarFooter className="border-t border-sidebar-border p-2">
        {user ? (
          <div
            className={cn(
              "flex items-center gap-2.5 rounded-lg p-2 transition-colors hover:bg-sidebar-accent",
              isCollapsed && "justify-center"
            )}
          >
            <Avatar className="size-8">
              <AvatarFallback className="bg-primary/10 text-primary text-xs font-semibold">
                {initials}
              </AvatarFallback>
            </Avatar>
            {!isCollapsed && (
              <div className="flex min-w-0 flex-1 items-center justify-between gap-2">
                <div className="flex min-w-0 flex-col leading-tight">
                  <span className="truncate text-xs font-semibold text-sidebar-foreground">
                    {user.name}
                  </span>
                  <span className="truncate text-[10px] text-muted-foreground">
                    {user.email}
                  </span>
                </div>
                <Badge variant={roleBadgeVariant[user.role] ?? "outline"} className="shrink-0 text-[9px] px-1.5 py-0 h-4">
                  {roleLabel[user.role] ?? user.role}
                </Badge>
              </div>
            )}
          </div>
        ) : (
          <div className={cn("flex items-center gap-2.5 p-2", isCollapsed && "justify-center")}>
            <Avatar className="size-8">
              <AvatarFallback className="bg-muted text-xs">NL</AvatarFallback>
            </Avatar>
            {!isCollapsed && (
              <div className="flex flex-col">
                <span className="text-xs font-semibold text-muted-foreground">Memuat…</span>
              </div>
            )}
          </div>
        )}
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  )
}

/**
 * Individual nav item with active state + hover polish.
 * Extracted so the active indicator can be rendered cleanly.
 */
function SidebarNavItem({
  item,
  pathname,
  isCollapsed,
}: {
  item: NavItem
  pathname: string
  isCollapsed: boolean
}) {
  const isActive =
    item.href === "/dashboard"
      ? pathname === "/dashboard"
      : pathname.startsWith(item.href)

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={isActive}
        tooltip={item.title}
        render={<Link href={item.href} />}
        className={cn(
          // Comfortable vertical padding for a less cramped feel.
          "h-10 px-2.5 text-sm transition-all duration-150",
          // Subtle scale-in on hover for tactile feedback.
          "hover:translate-x-0.5",
          // Active state: slightly bolder + left accent bar via border-l.
          isActive &&
            "bg-sidebar-accent font-semibold text-sidebar-accent-foreground border-l-2 border-primary rounded-l-none",
          // Make the icon inherit accent color when active.
          isActive && "[&_svg]:text-primary"
        )}
      >
        <item.icon className={cn("size-4 shrink-0", isActive && "text-primary")} />
        <span className="truncate">{item.title}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
}
