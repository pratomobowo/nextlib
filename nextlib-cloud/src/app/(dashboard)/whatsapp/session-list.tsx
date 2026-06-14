"use client";

import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Plug, MessageCircle } from "lucide-react";
import { SessionCard } from "@/components/whatsapp/session-card";
import { QRScanner } from "@/components/whatsapp/qr-scanner";
import type { WhatsappSession, Tenant } from "@/lib/db/schema";
import { useState } from "react";

interface TenantsWithSessions {
  tenant: Pick<Tenant, "id" | "name" | "slug">;
  session: WhatsappSession | null;
}

interface WhatsAppSessionListProps {
  tenantsWithSessions: TenantsWithSessions[];
  isReadOnly?: boolean;
}

export function WhatsAppSessionList({
  tenantsWithSessions,
  isReadOnly = false,
}: WhatsAppSessionListProps) {
  const router = useRouter();
  const [connectingTenantId, setConnectingTenantId] = useState<string | null>(
    null
  );

  // If read-only, block initiating new connections
  function handleNewConnection(tenantId: string) {
    if (isReadOnly) return;
    setConnectingTenantId(tenantId);
  }

  function handleConnected() {
    setConnectingTenantId(null);
    router.refresh();
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {tenantsWithSessions.map(({ tenant, session }) => {
        if (session) {
          return (
            <SessionCard
              key={tenant.id}
              session={{ ...session, tenantName: tenant.name }}
              isReadOnly={isReadOnly}
            />
          );
        }

        // No session and user clicked "Hubungkan WhatsApp" — show QR scanner
        if (!isReadOnly && connectingTenantId === tenant.id) {
          return (
            <Card key={tenant.id} className="relative overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 to-indigo-500/5 pointer-events-none" />
              <CardHeader className="relative">
                <CardTitle className="flex items-center gap-2 text-base">
                  <MessageCircle className="h-4 w-4" />
                  {tenant.name}
                </CardTitle>
              </CardHeader>
              <CardContent className="relative">
                <QRScanner
                  tenantId={tenant.id}
                  onConnected={handleConnected}
                />
              </CardContent>
            </Card>
          );
        }

        return (
          <Card
            key={tenant.id}
            className="relative overflow-hidden transition-all duration-300 hover:shadow-md"
          >
            <div className="absolute inset-0 bg-gradient-to-br from-gray-500/5 to-slate-500/5 pointer-events-none" />
            <CardHeader className="relative">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">{tenant.name}</CardTitle>
                <Badge variant="secondary">
                  <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-gray-400" />
                  Belum Terhubung
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground font-mono">
                {tenant.slug}
              </p>
            </CardHeader>
            <CardContent className="relative">
              <div className="flex flex-col items-center justify-center py-6 space-y-3">
                <p className="text-sm text-muted-foreground text-center">
                  WhatsApp belum dihubungkan untuk tenant ini.
                </p>
                {!isReadOnly ? (
                  <Button
                    onClick={() => handleNewConnection(tenant.id)}
                    className="gap-1.5"
                    size="sm"
                  >
                    <Plug className="h-3.5 w-3.5" />
                    Hubungkan WhatsApp
                  </Button>
                ) : (
                  <p className="text-xs text-amber-500 font-medium text-center">
                    Hubungi Tenant Admin untuk menghubungkan.
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
