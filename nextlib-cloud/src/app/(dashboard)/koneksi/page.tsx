import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { db } from "@/lib/db"
import { tenants } from "@/lib/db/schema"
import { desc, eq } from "drizzle-orm"
import { getSessionUser } from "@/lib/auth/session"
import { DisconnectButton } from "@/components/tenant/disconnect-button"
import { ConnectionEditor } from "@/components/tenant/connection-editor"
import { redirect } from "next/navigation"

export const dynamic = "force-dynamic"

export default async function KoneksiPage() {
  const sessionUser = await getSessionUser()
  if (!sessionUser) redirect("/login")

  const isSuperAdmin = sessionUser.user.role === "super_admin"

  const baseQuery = db
    .select({
      id: tenants.id,
      name: tenants.name,
      slug: tenants.slug,
      status: tenants.status,
      updatedAt: tenants.updatedAt,
      ed25519PublicKey: tenants.ed25519PublicKey,
      ed25519RotatedAt: tenants.ed25519RotatedAt,
    })
    .from(tenants)
    .orderBy(desc(tenants.updatedAt))

  const allTenants = isSuperAdmin
    ? await baseQuery
    : await baseQuery.where(eq(tenants.id, sessionUser.user.tenantId!))

  // For tenant_admin: render the editor for their own tenant
  if (!isSuperAdmin && allTenants.length === 1) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Koneksi</h1>
          <p className="text-muted-foreground">
            Status koneksi NextLib ↔ SLiMS kampus Anda
          </p>
        </div>
        <ConnectionEditor
          tenant={{
            id: allTenants[0].id,
            name: allTenants[0].name,
            slug: allTenants[0].slug,
            status: allTenants[0].status,
            ed25519PublicKey: allTenants[0].ed25519PublicKey,
            ed25519RotatedAt: allTenants[0].ed25519RotatedAt,
          }}
        />
      </div>
    )
  }

  // For super_admin: keep existing list view (unchanged below)
  const connected = allTenants.filter((t) => t.status === "connected").length
  const pending = allTenants.filter((t) => t.status === "pending").length
  const disconnected = allTenants.filter((t) => t.status === "disconnected").length

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Koneksi</h1>
        <p className="text-muted-foreground">
          Status koneksi antara NextLib-Cloud dan SLiMS kampus
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Connected</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{connected}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Pending</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-yellow-600">{pending}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Disconnected</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">{disconnected}</div>
          </CardContent>
        </Card>
      </div>

      {allTenants.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <Badge variant="secondary" className="mb-4">
              Tidak ada koneksi
            </Badge>
            <p className="text-sm text-muted-foreground">
              Daftarkan tenant terlebih dahulu, lalu pasang plugin di SLiMS kampus.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Daftar Koneksi</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {allTenants.map((tenant) => (
                <div
                  key={tenant.id}
                  className="flex items-center justify-between rounded-lg border p-3"
                >
                  <div className="space-y-0.5">
                    <p className="text-sm font-medium">{tenant.name}</p>
                    <p className="text-xs text-muted-foreground font-mono">{tenant.slug}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge status={tenant.status} />
                    {tenant.status === "connected" && (
                      <DisconnectButton tenantId={tenant.id} tenantName={tenant.name} />
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case "connected":
      return <Badge className="bg-green-500/10 text-green-600 border-green-500/20">Connected</Badge>
    case "disconnected":
      return <Badge variant="destructive">Disconnected</Badge>
    default:
      return <Badge variant="secondary">Pending</Badge>
  }
}
