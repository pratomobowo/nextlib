"use client";

import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { WhatsAppSessionList } from "./session-list";
import { MessageStats } from "@/components/whatsapp/message-stats";
import type { Tenant, WhatsappSession } from "@/lib/db/schema";
import { BarChart3, MessageSquare, BookOpen } from "lucide-react";
import Link from "next/link";

interface TenantsWithSessions {
  tenant: Pick<Tenant, "id" | "name" | "slug">;
  session: WhatsappSession | null;
}

interface DashboardTabsProps {
  tenantsWithSessions: TenantsWithSessions[];
  isReadOnly?: boolean;
}

export function DashboardTabs({ tenantsWithSessions, isReadOnly = false }: DashboardTabsProps) {
  // Find first tenant that has a session, or just the first tenant overall
  const defaultSelectedTenant =
    tenantsWithSessions.find((t) => t.session)?.tenant.id ||
    tenantsWithSessions[0]?.tenant.id ||
    "";

  const [selectedTenantId, setSelectedTenantId] = useState<string>(
    defaultSelectedTenant
  );

  return (
    <Tabs defaultValue="gateway" className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <TabsList className="bg-background border">
          <TabsTrigger value="gateway" className="gap-2">
            <MessageSquare className="h-4 w-4" />
            Koneksi Gateway
          </TabsTrigger>
          <TabsTrigger value="stats" className="gap-2">
            <BarChart3 className="h-4 w-4" />
            Statistik Chat
          </TabsTrigger>
        </TabsList>
      </div>

      <TabsContent value="gateway" className="space-y-4">
        <div className="space-y-4">
          <h2 className="text-lg font-medium text-foreground">Daftar Tenant</h2>
          <WhatsAppSessionList tenantsWithSessions={tenantsWithSessions} isReadOnly={isReadOnly} />
        </div>
      </TabsContent>

      <TabsContent value="stats" className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-muted/30 p-4 rounded-xl border">
          <div className="flex items-center gap-3">
            <label className="text-sm font-medium text-muted-foreground whitespace-nowrap">
              Pilih Tenant Kampus:
            </label>
            <select
              value={selectedTenantId}
              onChange={(e) => setSelectedTenantId(e.target.value)}
              className="rounded-lg border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring min-w-[200px]"
            >
              {tenantsWithSessions.map(({ tenant }) => (
                <option key={tenant.id} value={tenant.id}>
                  {tenant.name}
                </option>
              ))}
            </select>
          </div>

          {selectedTenantId && (
            <Link
              href={`/whatsapp/knowledge-base?tenantId=${selectedTenantId}`}
              className="inline-flex items-center gap-1.5 text-sm text-primary hover:text-primary/80 transition-colors font-medium"
            >
              <BookOpen className="h-4 w-4" />
              Kelola Basis Pengetahuan Tenant
            </Link>
          )}
        </div>

        {selectedTenantId ? (
          <MessageStats tenantId={selectedTenantId} />
        ) : (
          <div className="text-center py-12 border rounded-xl bg-card text-muted-foreground text-sm">
            Silakan pilih tenant untuk melihat statistik.
          </div>
        )}
      </TabsContent>
    </Tabs>
  );
}
