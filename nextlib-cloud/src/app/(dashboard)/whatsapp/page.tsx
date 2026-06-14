import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { db } from "@/lib/db";
import { tenants, whatsappSessions } from "@/lib/db/schema";
import { desc, eq } from "drizzle-orm";
import { Wifi, WifiOff, QrCode, MessageCircle, BookOpen } from "lucide-react";
import Link from "next/link";
import { DashboardTabs } from "./dashboard-tabs";
import { getSessionUser } from "@/lib/auth/session";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function WhatsAppPage() {
  const sessionContext = await getSessionUser();
  if (!sessionContext) {
    redirect("/login");
  }

  const { user } = sessionContext;

  // Fetch tenants & sessions based on role
  let allTenants;
  let allSessions;

  if (user.role === "super_admin") {
    allTenants = await db
      .select({
        id: tenants.id,
        name: tenants.name,
        slug: tenants.slug,
      })
      .from(tenants)
      .orderBy(desc(tenants.updatedAt));

    allSessions = await db
      .select()
      .from(whatsappSessions)
      .orderBy(desc(whatsappSessions.updatedAt));
  } else {
    // Scoped query for tenant_admin and librarian
    const tenantId = user.tenantId;
    if (!tenantId) {
      return (
        <div className="p-8 text-center border border-dashed rounded-xl bg-background/50">
          <p className="text-muted-foreground">Akun Anda tidak terhubung dengan tenant mana pun.</p>
        </div>
      );
    }

    allTenants = await db
      .select({
        id: tenants.id,
        name: tenants.name,
        slug: tenants.slug,
      })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .orderBy(desc(tenants.updatedAt));

    allSessions = await db
      .select()
      .from(whatsappSessions)
      .where(eq(whatsappSessions.tenantId, tenantId))
      .orderBy(desc(whatsappSessions.updatedAt));
  }

  // Build session map keyed by tenantId
  const sessionMap = new Map(
    allSessions.map((s) => [s.tenantId, s])
  );

  // Compute stats
  const connected = allSessions.filter((s) => s.status === "connected").length;
  const disconnected = allSessions.filter(
    (s) => s.status === "disconnected"
  ).length;
  const pendingQr = allSessions.filter(
    (s) => s.status === "pending_qr"
  ).length;
  const totalSessions = allSessions.length;

  // Build tenant data with sessions for the client component
  const tenantsWithSessions = allTenants.map((tenant) => ({
    tenant,
    session: sessionMap.get(tenant.id) || null,
  }));

  const isReadOnly = user.role === "librarian";

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-green-500 to-emerald-600 shadow-lg shadow-green-500/25">
            <MessageCircle className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              WhatsApp Gateway
            </h1>
            <p className="text-muted-foreground">
              {isReadOnly
                ? "Pantau status koneksi WhatsApp untuk institusi Anda"
                : "Kelola koneksi WhatsApp untuk layanan AI Librarian"}
            </p>
          </div>
        </div>

        <Link
          href="/whatsapp/knowledge-base"
          className="inline-flex items-center justify-center gap-2 rounded-lg border bg-background px-4 py-2.5 text-sm font-medium hover:bg-muted transition-colors shadow-sm self-start sm:self-auto"
        >
          <BookOpen className="h-4 w-4" />
          Kelola Basis Pengetahuan
        </Link>
      </div>

      {/* Summary cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card className="relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 to-indigo-500/5 pointer-events-none" />
          <CardHeader className="pb-2 relative">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Sesi
            </CardTitle>
          </CardHeader>
          <CardContent className="relative">
            <div className="text-2xl font-bold">{totalSessions}</div>
          </CardContent>
        </Card>

        <Card className="relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-green-500/5 to-emerald-500/5 pointer-events-none" />
          <CardHeader className="pb-2 relative">
            <CardTitle className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
              <Wifi className="h-3.5 w-3.5 text-green-500" />
              Connected
            </CardTitle>
          </CardHeader>
          <CardContent className="relative">
            <div className="text-2xl font-bold text-green-600">
              {connected}
            </div>
          </CardContent>
        </Card>

        <Card className="relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-red-500/5 to-rose-500/5 pointer-events-none" />
          <CardHeader className="pb-2 relative">
            <CardTitle className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
              <WifiOff className="h-3.5 w-3.5 text-red-500" />
              Disconnected
            </CardTitle>
          </CardHeader>
          <CardContent className="relative">
            <div className="text-2xl font-bold text-red-600">
              {disconnected}
            </div>
          </CardContent>
        </Card>

        <Card className="relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-amber-500/5 to-yellow-500/5 pointer-events-none" />
          <CardHeader className="pb-2 relative">
            <CardTitle className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
              <QrCode className="h-3.5 w-3.5 text-amber-500" />
              Pending QR
            </CardTitle>
          </CardHeader>
          <CardContent className="relative">
            <div className="text-2xl font-bold text-amber-600">
              {pendingQr}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tenant session list / tabs */}
      {allTenants.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <Badge variant="secondary" className="mb-4">
              Belum ada tenant
            </Badge>
            <p className="text-sm text-muted-foreground">
              Daftarkan tenant terlebih dahulu sebelum menghubungkan WhatsApp.
            </p>
          </CardContent>
        </Card>
      ) : (
        <DashboardTabs tenantsWithSessions={tenantsWithSessions} isReadOnly={isReadOnly} />
      )}
    </div>
  );
}
