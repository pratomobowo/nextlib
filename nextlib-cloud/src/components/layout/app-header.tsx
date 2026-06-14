"use client"

import React from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { LogOut, User } from "lucide-react"
import { ThemeToggle } from "@/components/layout/theme-toggle"

import { SidebarTrigger } from "@/components/ui/sidebar"
import { Separator } from "@/components/ui/separator"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

function formatSegment(segment: string): string {
  return segment
    .replace(/-/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

export function AppHeader() {
  const pathname = usePathname()
  const router = useRouter()
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
        console.error("Failed to load user:", error)
      }
    }
    loadUser()
  }, [])

  async function handleLogout() {
    try {
      const res = await fetch("/api/v1/auth/logout", {
        method: "POST",
      })
      if (res.ok) {
        router.push("/login")
        router.refresh()
      }
    } catch (error) {
      console.error("Failed to logout:", error)
    }
  }

  const segments = pathname.split("/").filter(Boolean)

  const breadcrumbItems = [
    { label: "Home", href: "/" },
    ...segments.map((segment, index) => ({
      label: formatSegment(segment),
      href: "/" + segments.slice(0, index + 1).join("/"),
    })),
  ]

  const initials = user
    ? user.name
        .split(" ")
        .map((n) => n[0])
        .join("")
        .substring(0, 2)
        .toUpperCase()
    : "NL"

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
      <SidebarTrigger className="-ml-1" />
      <Separator orientation="vertical" className="mr-2 !h-4" />

      <Breadcrumb className="flex-1">
        <BreadcrumbList>
          {breadcrumbItems.map((item, index) => {
            const isLast = index === breadcrumbItems.length - 1

            return (
              <React.Fragment key={item.href}>
                {index > 0 && <BreadcrumbSeparator />}
                <BreadcrumbItem>
                  {isLast ? (
                    <BreadcrumbPage>{item.label}</BreadcrumbPage>
                  ) : (
                    <BreadcrumbLink render={<Link href={item.href} />}>
                      {item.label}
                    </BreadcrumbLink>
                  )}
                </BreadcrumbItem>
              </React.Fragment>
            )
          })}
        </BreadcrumbList>
      </Breadcrumb>

      <ThemeToggle />

      <DropdownMenu>
        <DropdownMenuTrigger className="cursor-pointer rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <Avatar size="sm">
            <AvatarFallback>{initials}</AvatarFallback>
          </Avatar>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" sideOffset={8} className="w-56">
          {user && (
            <div className="flex flex-col px-2 py-1.5 text-xs text-muted-foreground border-b mb-1">
              <span className="font-medium text-foreground">{user.name}</span>
              <span className="truncate">{user.email}</span>
              <span className="mt-1 inline-block w-fit rounded bg-primary/10 px-1 py-0.5 font-semibold text-[10px] text-primary uppercase">
                {user.role.replace("_", " ")}
              </span>
            </div>
          )}
          <DropdownMenuItem>
            <User />
            <span>Profile</span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onClick={handleLogout} className="cursor-pointer">
            <LogOut />
            <span>Logout</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  )
}
