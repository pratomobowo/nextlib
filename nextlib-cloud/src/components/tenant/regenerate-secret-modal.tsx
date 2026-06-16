"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tenantId: string;
};

export function RegenerateSecretModal({ open, onOpenChange, tenantId }: Props) {
  const [confirmed, setConfirmed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [newToken, setNewToken] = useState<string | null>(null);

  if (!open) return null;

  const regenerate = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/tenants/${tenantId}/regenerate-secret`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(err.message || "Gagal regenerate");
        return;
      }
      const body = await res.json();
      setNewToken(body.data.api_token);
    } catch {
      alert("Gagal terhubung ke server");
    } finally {
      setLoading(false);
    }
  };

  const close = () => {
    onOpenChange(false);
    setTimeout(() => {
      setNewToken(null);
      setConfirmed(false);
    }, 200);
  };

  const copy = async () => {
    if (!newToken) return;
    await navigator.clipboard.writeText(newToken);
    alert("Token disalin");
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={close}
    >
      <div
        className="w-full max-w-md rounded-lg bg-background p-6 shadow-lg space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        {newToken ? (
          <>
            <h2 className="text-lg font-semibold">Token Baru</h2>
            <p className="text-sm text-muted-foreground">
              ⚠ Simpan token ini sekarang. Tidak akan ditampilkan lagi.
            </p>
            <code className="block overflow-x-auto rounded-lg border bg-muted/50 px-3 py-2 text-xs font-mono break-all">
              {newToken}
            </code>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={copy}>Salin</Button>
              <Button onClick={close}>Tutup</Button>
            </div>
          </>
        ) : (
          <>
            <h2 className="text-lg font-semibold">Regenerate API Token</h2>
            <p className="text-sm">
              Token lama akan <strong>langsung tidak valid</strong>. Anda harus update
              plugin NextLib-Agent di SLiMS dengan token baru dalam 24 jam.
            </p>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
                className="mt-1"
                aria-label="Saya paham token lama akan langsung tidak valid"
              />
              <span>Saya paham token lama akan langsung tidak valid</span>
            </label>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={close} disabled={loading}>
                Batal
              </Button>
              <Button onClick={regenerate} disabled={!confirmed || loading} variant="destructive">
                {loading ? "Memproses..." : "Regenerate Token"}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
