"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  QrCode,
  RefreshCw,
  CheckCircle2,
  Loader2,
  Wifi,
  WifiOff,
} from "lucide-react";

interface QRScannerProps {
  tenantId: string;
  onConnected?: () => void;
}

type ScannerState = "idle" | "loading" | "qr_displayed" | "scanning" | "connected" | "error";

export function QRScanner({ tenantId, onConnected }: QRScannerProps) {
  const [state, setState] = useState<ScannerState>("idle");
  const [qrLink, setQrLink] = useState<string | null>(null);
  const [qrDuration, setQrDuration] = useState<number>(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState<number>(0);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Cleanup intervals on unmount
  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, []);

  const stopPolling = useCallback(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
    if (countdownRef.current) {
      clearInterval(countdownRef.current);
      countdownRef.current = null;
    }
  }, []);

  const startPolling = useCallback(() => {
    stopPolling();

    pollIntervalRef.current = setInterval(async () => {
      try {
        const res = await fetch(
          `/api/v1/whatsapp/session?tenantId=${encodeURIComponent(tenantId)}`
        );
        const data = await res.json();

        if (data.success && data.data?.status === "connected") {
          stopPolling();
          setState("connected");
          onConnected?.();
        }
      } catch {
        // Silently retry on next poll
      }
    }, 5000);
  }, [tenantId, onConnected, stopPolling]);

  const requestQR = useCallback(async () => {
    setState("loading");
    setErrorMessage(null);
    stopPolling();

    try {
      const res = await fetch("/api/v1/whatsapp/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenantId }),
      });

      const data = await res.json();

      if (!data.success) {
        setState("error");
        setErrorMessage(data.error || "Gagal membuat QR code");
        return;
      }

      setQrLink(data.data.qrLink);
      setQrDuration(data.data.qrDuration);
      setSecondsLeft(data.data.qrDuration || 60);
      setState("qr_displayed");

      // Start countdown timer
      countdownRef.current = setInterval(() => {
        setSecondsLeft((prev) => {
          if (prev <= 1) {
            stopPolling();
            setState("idle");
            return 0;
          }
          return prev - 1;
        });
      }, 1000);

      // Start polling for connection status
      startPolling();
    } catch {
      setState("error");
      setErrorMessage("Tidak dapat terhubung ke server");
    }
  }, [tenantId, startPolling, stopPolling]);

  return (
    <Card className="relative overflow-hidden">
      {/* Animated gradient border for scanning state */}
      {(state === "qr_displayed" || state === "scanning") && (
        <div className="absolute inset-0 rounded-xl bg-gradient-to-r from-green-500/20 via-emerald-500/20 to-teal-500/20 animate-pulse pointer-events-none" />
      )}

      <CardHeader className="relative">
        <CardTitle className="flex items-center gap-2 text-sm">
          <QrCode className="h-4 w-4" />
          WhatsApp QR Scanner
        </CardTitle>
      </CardHeader>

      <CardContent className="relative">
        <div className="flex flex-col items-center justify-center space-y-4 py-4">
          {/* Idle State */}
          {state === "idle" && (
            <>
              <div className="flex h-48 w-48 items-center justify-center rounded-2xl border-2 border-dashed border-muted-foreground/25 bg-muted/30">
                <div className="text-center space-y-2">
                  <Wifi className="h-10 w-10 mx-auto text-muted-foreground/50" />
                  <p className="text-xs text-muted-foreground">
                    Scan QR untuk menghubungkan
                  </p>
                </div>
              </div>
              <Button onClick={requestQR} className="gap-2">
                <QrCode className="h-4 w-4" />
                Generate QR Code
              </Button>
            </>
          )}

          {/* Loading State */}
          {state === "loading" && (
            <div className="flex h-48 w-48 items-center justify-center rounded-2xl border-2 border-muted-foreground/25 bg-muted/30">
              <div className="text-center space-y-3">
                <Loader2 className="h-8 w-8 mx-auto animate-spin text-primary" />
                <p className="text-xs text-muted-foreground">
                  Memuat QR Code...
                </p>
              </div>
            </div>
          )}

          {/* QR Displayed State */}
          {state === "qr_displayed" && qrLink && (
            <>
              <div className="relative group">
                {/* Animated scanning border */}
                <div className="absolute -inset-1 rounded-2xl bg-gradient-to-r from-green-400 via-emerald-500 to-teal-400 opacity-50 blur-sm animate-pulse group-hover:opacity-75 transition-opacity" />
                <div className="relative rounded-2xl bg-white p-3 shadow-lg">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={qrLink}
                    alt="WhatsApp QR Code"
                    className="h-48 w-48 object-contain"
                  />
                </div>
              </div>

              <div className="text-center space-y-1">
                <Badge
                  variant="secondary"
                  className="bg-amber-500/10 text-amber-600 border-amber-500/20"
                >
                  <Loader2 className="h-3 w-3 animate-spin mr-1" />
                  Menunggu scan...
                </Badge>
                <p className="text-xs text-muted-foreground">
                  QR berlaku {secondsLeft} detik lagi
                </p>
              </div>

              <Button
                variant="outline"
                size="sm"
                onClick={requestQR}
                className="gap-1.5"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Refresh QR
              </Button>
            </>
          )}

          {/* Connected State */}
          {state === "connected" && (
            <>
              <div className="flex h-48 w-48 items-center justify-center rounded-2xl border-2 border-green-500/30 bg-green-500/5">
                <div className="text-center space-y-3">
                  <CheckCircle2 className="h-12 w-12 mx-auto text-green-500 animate-bounce" />
                  <p className="text-sm font-medium text-green-600">
                    Terhubung!
                  </p>
                </div>
              </div>
              <Badge className="bg-green-500/10 text-green-600 border-green-500/20">
                WhatsApp Connected
              </Badge>
            </>
          )}

          {/* Error State */}
          {state === "error" && (
            <>
              <div className="flex h-48 w-48 items-center justify-center rounded-2xl border-2 border-red-500/30 bg-red-500/5">
                <div className="text-center space-y-3 px-4">
                  <WifiOff className="h-10 w-10 mx-auto text-red-400" />
                  <p className="text-xs text-red-500">{errorMessage}</p>
                </div>
              </div>
              <Button
                variant="outline"
                onClick={requestQR}
                className="gap-1.5"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Coba Lagi
              </Button>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
