import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { buttonVariants } from "@/components/ui/button"
import { Plus } from "lucide-react"
import { db } from "@/lib/db"
import { tenants } from "@/lib/db/schema"
import { desc } from "drizzle-orm"
import { DeleteTenantButton } from "@/components/tenant/delete-tenant-button"

export const dynamic = "force-dynamic"

export default async function TenantsPage() {
  const allTenants = await db
    .select({
      id: tenants.id,
      name: tenants.name,
      slug: tenants.slug,
      status: tenants.status,
      createdAt: tenants.createdAt,
    })
    .from(tenants)
    .orderBy(desc(tenants.createdAt))

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Tenants</h1>
          <p className="text-muted-foreground">
            Kelola daftar kampus yang terhubung ke NextLib
          </p>
        </div>
        <Link href="/tenants/new" className={buttonVariants()}>
          <Plus className="mr-2 h-4 w-4" />
          Tambah Tenant
        </Link>
      </div>

      {allTenants.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <p className="text-muted-foreground mb-4">
              Belum ada tenant terdaftar
            </p>
            <Link href="/tenants/new" className={buttonVariants({ variant: "outline" })}>
              <Plus className="mr-2 h-4 w-4" />
              Daftarkan Tenant Pertama
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {allTenants.map((tenant) => (
            <Card key={tenant.id}>
              <CardContent className="flex items-center justify-between py-4">
                <div className="space-y-1">
                  <p className="font-medium">{tenant.name}</p>
                  <p className="text-sm text-muted-foreground font-mono">
                    {tenant.slug}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <StatusBadge status={tenant.status} />
                  <span className="text-xs text-muted-foreground">
                    {new Date(tenant.createdAt).toLocaleDateString("id-ID")}
                  </span>
                  <DeleteTenantButton tenantId={tenant.id} tenantName={tenant.name} />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
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
