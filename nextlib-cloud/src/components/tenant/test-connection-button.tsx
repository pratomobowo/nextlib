"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

interface TestConnectionButtonProps {
  tenantId: string;
}

interface TestConnectionResult {
  success: boolean;
  responseTimeMs: number;
  statusCode: number;
  status: "connected" | "disconnected";
  url: string;
  category: string;
  title: string;
  suggestion: string;
  error: string | null;
  slimsStatus: string | null;
  slimsDbConnected: boolean | null;
  responseBodyPreview: string | null;
}

const CATEGORY_ICON: Record<string, string> = {
  ok: "✅",
  plugin_unhealthy: "⚠️",
  plugin_not_installed: "❌",
  routing_misconfigured: "⚠️",
  auth_failed: "🔒",
  server_error: "💥",
  timeout: "⏱️",
  network_unreachable: "🌐",
  blocked: "🛑",
  unknown: "❓",
};

export function TestConnectionButton({ tenantId }: { tenantId: string }) {
  const [isPending, setIsPending] = useState(false);

  async function handleClick() {
    setIsPending(true);
    try {
      const res = await fetch(`/api/v1/tenants/${tenantId}/test-connection`, {
        method: "POST",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(body.message || `Gagal test koneksi (HTTP ${res.status})`);
        return;
      }
      const d: TestConnectionResult = body.data;
      const icon = CATEGORY_ICON[d.category] ?? "❓";
      const lines = [
        `${icon} ${d.title}`,
        ``,
        `URL: ${d.url}`,
        d.statusCode ? `HTTP status: ${d.statusCode}` : null,
        d.responseTimeMs ? `Response time: ${d.responseTimeMs}ms` : null,
        d.slimsStatus ? `SLiMS reported: ${d.slimsStatus}` : null,
        d.slimsDbConnected === false ? `SLiMS DB: not connected` : null,
        d.error ? `Error: ${d.error}` : null,
        ``,
        `💡 ${d.suggestion}`,
        d.responseBodyPreview && d.responseBodyPreview.length > 0
          ? `\nServer response (first 500 chars):\n${d.responseBodyPreview}`
          : null,
      ].filter(Boolean) as string[];
      alert(lines.join("\n"));
    } catch {
      alert(
        "Gagal terhubung ke server SaaS (bukan ke SLiMS). Cek koneksi internet Anda."
      );
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
