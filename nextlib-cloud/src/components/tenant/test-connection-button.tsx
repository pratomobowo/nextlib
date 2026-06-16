"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

interface TestConnectionButtonProps {
  tenantId: string;
}

export function TestConnectionButton({ tenantId }: TestConnectionButtonProps) {
  const [isPending, setIsPending] = useState(false);

  async function handleClick() {
    setIsPending(true);
    try {
      const res = await fetch(`/api/v1/tenants/${tenantId}/test-connection`, {
        method: "POST",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(body.message || "Gagal test koneksi");
        return;
      }
      if (body.data?.success) {
        alert(`Terhubung dalam ${body.data.responseTimeMs}ms`);
      } else {
        alert(`Tidak terhubung: ${body.data?.error ?? body.data?.statusCode ?? "unknown"}`);
      }
    } catch {
      alert("Gagal terhubung ke server");
    } finally {
      setIsPending(false);
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      onClick={handleClick}
      disabled={isPending}
    >
      {isPending ? "Testing..." : "Test Koneksi"}
    </Button>
  );
}
