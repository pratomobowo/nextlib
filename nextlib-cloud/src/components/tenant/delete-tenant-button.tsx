"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"
import { Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"

interface DeleteTenantButtonProps {
  tenantId: string
  tenantName: string
}

export function DeleteTenantButton({ tenantId, tenantName }: DeleteTenantButtonProps) {
  const router = useRouter()
  const [isDeleting, setIsDeleting] = useState(false)

  async function handleDelete() {
    const confirmed = confirm(
      `Hapus tenant "${tenantName}"? Semua data statistik juga akan dihapus. Tindakan ini tidak dapat dibatalkan.`
    )
    if (!confirmed) return

    setIsDeleting(true)
    try {
      const res = await fetch(`/api/v1/tenants/${tenantId}`, {
        method: "DELETE",
      })

      if (!res.ok) {
        const data = await res.json()
        alert(data.message || "Gagal menghapus tenant")
        return
      }

      router.refresh()
    } catch {
      alert("Terjadi kesalahan saat menghapus tenant")
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <Button
      variant="destructive"
      size="sm"
      onClick={handleDelete}
      disabled={isDeleting}
      aria-label={`Hapus tenant ${tenantName}`}
    >
      <Trash2 className="h-3.5 w-3.5 mr-1" />
      {isDeleting ? "Menghapus..." : "Hapus"}
    </Button>
  )
}
