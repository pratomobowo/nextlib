"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatDistanceToNow } from "date-fns";
import { id as localeId } from "date-fns/locale/id";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Smartphone,
  Unplug,
  Plug,
  Clock,
  Phone,
  Building2,
} from "lucide-react";
import type { WhatsappSession } from "@/lib/db/schema";
import { QRScanner } from "./qr-scanner";

interface SessionCardProps {
  session: WhatsappSession & { tenantName: string };
  onDisconnect?: () => void;
  onConnect?: () => void;
  isReadOnly?: boolean;
}

export function SessionCard({
  session,
  onDisconnect,
  onConnect,
  isReadOnly = false,
}: SessionCardProps) {
  const router = useRouter();
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [showQR, setShowQR] = useState(session.status === "pending_qr");

  async function handleDisconnect() {
    const confirmed = confirm(
      `Putuskan koneksi WhatsApp untuk "${session.tenantName}"? Layanan AI Librarian akan berhenti sampai terhubung kembali.`
    );
    if (!confirmed) return;

    setIsDisconnecting(true);
    try {
      const res = await fetch(
        `/api/v1/whatsapp/session?tenantId=${encodeURIComponent(session.tenantId)}`,
        { method: "DELETE" }
      );

      if (!res.ok) {
        const data = await res.json();
        alert(data.error || "Gagal memutus koneksi WhatsApp");
        return;
      }

      onDisconnect?.();
      router.refresh();
    } catch {
      alert("Terjadi kesalahan saat memutus koneksi");
    } finally {
      setIsDisconnecting(false);
    }
  }

  function handleReconnect() {
    setShowQR(true);
    onConnect?.();
  }

  function handleConnected() {
    setShowQR(false);
    router.refresh();
  }

  const statusConfig = {
    connected: {
      badge: (
        <Badge className="bg-green-500/10 text-green-600 border-green-500/20">
          <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-green-500 animate-pulse" />
          Connected
        </Badge>
      ),
      gradient: "from-green-500/5 via-emerald-500/5 to-teal-500/5",
      borderColor: "ring-green-500/20",
    },
    disconnected: {
      badge: (
        <Badge variant="destructive">
          <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-red-400" />
          Disconnected
        </Badge>
      ),
      gradient: "from-red-500/5 via-rose-500/5 to-pink-500/5",
      borderColor: "ring-red-500/20",
    },
    pending_qr: {
      badge: (
        <Badge className="bg-amber-500/10 text-amber-600 border-amber-500/20">
          <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-amber-500 animate-pulse" />
          Menunggu QR Scan
        </Badge>
      ),
      gradient: "from-amber-500/5 via-yellow-500/5 to-orange-500/5",
      borderColor: "ring-amber-500/20",
    },
  };

  const config =
    statusConfig[session.status as keyof typeof statusConfig] ||
    statusConfig.disconnected;

  return (
    <Card
      className={`relative overflow-hidden transition-all duration-300 hover:shadow-md ${config.borderColor}`}
    >
      {/* Subtle gradient background */}
      <div
        className={`absolute inset-0 bg-gradient-to-br ${config.gradient} pointer-events-none`}
      />

      <CardHeader className="relative">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
              <Building2 className="h-5 w-5 text-primary" />
            </div>
            <div>
              <CardTitle className="text-base">{session.tenantName}</CardTitle>
              <CardDescription className="flex items-center gap-1.5 mt-0.5">
                <Smartphone className="h-3 w-3" />
                {session.phoneNumber
                  ? `+${session.phoneNumber}`
                  : "Belum terhubung"}
              </CardDescription>
            </div>
          </div>
          {config.badge}
        </div>
      </CardHeader>

      <CardContent className="relative space-y-4">
        {/* Session info */}
        <div className="grid grid-cols-2 gap-3 text-sm">
          {session.status === "connected" && session.connectedAt && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Clock className="h-3.5 w-3.5" />
              <span>
                Terhubung{" "}
                {formatDistanceToNow(new Date(session.connectedAt), {
                  addSuffix: true,
                  locale: localeId,
                })}
              </span>
            </div>
          )}

          {session.status === "disconnected" && session.disconnectedAt && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Clock className="h-3.5 w-3.5" />
              <span>
                Terputus{" "}
                {formatDistanceToNow(new Date(session.disconnectedAt), {
                  addSuffix: true,
                  locale: localeId,
                })}
              </span>
            </div>
          )}

          {session.deviceId && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Phone className="h-3.5 w-3.5" />
              <span className="font-mono text-xs truncate">
                {session.deviceId}
              </span>
            </div>
          )}
        </div>

        {/* QR Scanner for pending_qr state */}
        {showQR && (
          <QRScanner tenantId={session.tenantId} onConnected={handleConnected} />
        )}

        {/* Action buttons */}
        {!isReadOnly && (
          <div className="flex gap-2 pt-2">
            {session.status === "connected" && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleDisconnect}
                disabled={isDisconnecting}
                className="gap-1.5 text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/20"
              >
                <Unplug className="h-3.5 w-3.5" />
                {isDisconnecting ? "Memutuskan..." : "Disconnect"}
              </Button>
            )}

            {session.status === "disconnected" && !showQR && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleReconnect}
                className="gap-1.5 text-green-600 hover:text-green-700 hover:bg-green-50 dark:hover:bg-green-950/20"
              >
                <Plug className="h-3.5 w-3.5" />
                Reconnect
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
