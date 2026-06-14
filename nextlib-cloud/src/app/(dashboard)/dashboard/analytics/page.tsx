import { Suspense } from "react"
import { redirect } from "next/navigation"
import { eq } from "drizzle-orm"

import { db } from "@/lib/db"
import { tenants } from "@/lib/db/schema"
import { getSessionUser } from "@/lib/auth/session"
import { AnalyticsPanel } from "@/components/analytics/analytics-panel"

export default async function AnalyticsPage() {
  const sessionContext = await getSessionUser()
  if (!sessionContext) {
    redirect("/login")
  }
  const { user } = sessionContext

  let allTenants: { id: string; name: string }[] = []

  if (user.role === "super_admin") {
    allTenants = await db
      .select({ id: tenants.id, name: tenants.name })
      .from(tenants)
  } else if (user.tenantId) {
    allTenants = await db
      .select({ id: tenants.id, name: tenants.name })
      .from(tenants)
      .where(eq(tenants.id, user.tenantId))
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Analytics</h1>
        <p className="text-muted-foreground">
          Statistik pengunjung, peminjaman, dan pengembalian
        </p>
      </div>

      <Suspense fallback={<AnalyticsPanelSkeleton />}>
        <AnalyticsPanel tenants={allTenants} />
      </Suspense>
    </div>
  )
}

function AnalyticsPanelSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-4">
        <div className="h-9 w-32 animate-pulse rounded-md bg-muted" />
        <div className="h-9 w-48 animate-pulse rounded-md bg-muted" />
        <div className="h-9 w-40 animate-pulse rounded-md bg-muted" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3">
        <div className="h-28 animate-pulse rounded-lg border bg-muted" />
        <div className="h-28 animate-pulse rounded-lg border bg-muted" />
        <div className="h-28 animate-pulse rounded-lg border bg-muted" />
      </div>
      <div className="h-[300px] animate-pulse rounded-lg border bg-muted" />
    </div>
  )
}
