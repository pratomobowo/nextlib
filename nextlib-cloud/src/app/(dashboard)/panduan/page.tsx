import { redirect } from "next/navigation"
import { getSessionUser } from "@/lib/auth/session"
import { PanduanPanel } from "@/components/panduan/panduan-panel"

export const metadata = {
  title: "Panduan — NextLib",
}

export default async function PanduanPage() {
  const sessionUser = await getSessionUser()
  if (!sessionUser) {
    redirect("/login?callbackUrl=%2Fpanduan")
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Panduan</h1>
        <p className="text-muted-foreground">
          Dokumentasi lengkap untuk setup dan penggunaan NextLib Platform
        </p>
      </div>
      <PanduanPanel />
    </div>
  )
}
