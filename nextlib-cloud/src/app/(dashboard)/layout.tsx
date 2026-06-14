import { redirect } from "next/navigation"
import { getSessionUser } from "@/lib/auth/session"
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar"
import { TooltipProvider } from "@/components/ui/tooltip"
import { AppSidebar } from "@/components/layout/app-sidebar"
import { AppHeader } from "@/components/layout/app-header"

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const sessionContext = await getSessionUser()
  if (!sessionContext) {
    redirect("/login")
  }

  return (
    <TooltipProvider>
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset>
          <AppHeader />
          <div className="flex-1 overflow-y-auto p-4">
            {children}
          </div>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  )
}
