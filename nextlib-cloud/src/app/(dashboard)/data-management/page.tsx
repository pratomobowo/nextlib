import { redirect } from "next/navigation"
import { getSessionUser } from "@/lib/auth/session"
import { BackfillPanel } from "@/components/data-management/backfill-panel"

export const metadata = {
  title: "Data Management — NextLib",
}

export default async function DataManagementPage() {
  const sessionUser = await getSessionUser()
  if (!sessionUser) {
    redirect("/login?callbackUrl=%2Fdata-management")
  }

  // tenant_admin and librarian can backfill their own tenant; super_admin
  // without a tenant has nothing to sync.
  if (!sessionUser.user.tenantId) {
    redirect("/dashboard")
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Data Management</h1>
        <p className="text-muted-foreground">
          Sinkronisasi data historis dari SLiMS ke NextLib-Cloud
        </p>
      </div>
      <BackfillPanel />
    </div>
  )
}
