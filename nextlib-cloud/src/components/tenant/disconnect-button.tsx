"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"
import { Unplug } from "lucide-react"
import { Button } from "@/components/ui/button"

interface DisconnectButtonProps {
  tenantId: string
  tenantName: string
}

export function DisconnectButton({ tenantId, tenantName }: DisconnectButtonProps) {
  const router = useRouter()
  const [isDisconnecting, setIsDisconnecting] = useState(false)

  async function handleDisconnect() {
    const confirmed = confirm(
      `Disconnect tenant "${tenantName}"? Tenant tidak akan mengirim data sampai terhubung kembali.`
    )
    if (!confirmed) return

    setIsDisconnecting(true)
    try {
      const res = await fetch(`/api/v1/tenants/${tenantId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "disconnected" }),
      })

      if (!res.ok) {
        const data = await res.json()
        alert(data.message || "Gagal disconnect tenant")
        return
      }

      router.refresh()
    } catch {
      alert("Terjadi kesalahan saat disconnect tenant")
    } finally {
      setIsDisconnecting(false)
    }
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleDisconnect}
      disabled={isDisconnecting}
      aria-label={`Disconnect tenant ${tenantName}`}
    >
      <Unplug className="h-3.5 w-3.5 mr-1" />
      {isDisconnecting ? "Disconnecting..." : "Disconnect"}
    </Button>
  )
}
