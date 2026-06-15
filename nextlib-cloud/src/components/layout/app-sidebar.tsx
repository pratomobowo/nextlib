"use client"

import React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { BarChart3, Building2, Database, LayoutDashboard, MessageCircle, Plug, Settings } from "lucide-react"

import { cn } from "@/lib/utils"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarFooter,
  useSidebar,
} from "@/components/ui/sidebar"

const navItems = [
  { title: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { title: "Analytics", href: "/dashboard/analytics", icon: BarChart3 },
  { title: "Tenants", href: "/tenants", icon: Building2 },
  { title: "Koneksi", href: "/koneksi", icon: Plug },
  { title: "Data Management", href: "/data-management", icon: Database },
  { title: "WhatsApp", href: "/whatsapp", icon: MessageCircle },
  { title: "Settings", href: "/settings", icon: Settings },
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

  const filteredNavItems = navItems.filter((item) => {
    // Hide administrative pages until user role is loaded to prevent flashes of unauthorized pages
    if (!user) {
      if (item.href === "/tenants" || item.href === "/koneksi" || item.href === "/data-management") return false
      return true
    }

    if (user.role === "super_admin") {
      // Super admin ONLY manages the SaaS platform (Dashboard and Tenants)
      return item.href === "/dashboard" || item.href === "/tenants"
    }

    // Tenant scoped users (tenant_admin and librarian)
    if (item.href === "/tenants") return false
    if (item.href === "/koneksi") {
      return user.role === "tenant_admin"
    }
    if (item.href === "/data-management") {
      return user.role === "tenant_admin"
    }
    return true
  })

  const initials = user
    ? user.name
        .split(" ")
        .map((n) => n[0])
        .join("")
        .substring(0, 2)
        .toUpperCase()
    : "NL"

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="flex items-center gap-2 px-2 py-1">
          <span className="text-sm font-semibold">NextLib</span>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {filteredNavItems.map((item) => {
                const isActive =
                  item.href === "/dashboard"
                    ? pathname === "/dashboard"
                    : pathname.startsWith(item.href)

                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      isActive={isActive}
                      tooltip={item.title}
                      render={<Link href={item.href} />}
                    >
                      <item.icon />
                      <span>{item.title}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t p-2">
        {user && (
          <div className={cn(
            "flex items-center gap-2 rounded-md p-1.5 transition-all",
            state === "collapsed" ? "justify-center" : "px-2"
          )}>
            <Avatar size="sm">
              <AvatarFallback>{initials}</AvatarFallback>
            </Avatar>
            {state !== "collapsed" && (
              <div className="flex flex-col min-w-0 flex-1">
                <span className="text-xs font-semibold truncate text-foreground">
                  {user.name}
                </span>
                <span className="text-[10px] text-muted-foreground truncate uppercase font-medium">
                  {user.role.replace("_", " ")}
                </span>
              </div>
            )}
          </div>
        )}
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
