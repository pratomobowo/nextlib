import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { db } from "@/lib/db"
import { tenants, whatsappSessions, dailyStatsV2, waMessageLog } from "@/lib/db/schema"
import { eq, desc, sql } from "drizzle-orm"
import { getSessionUser } from "@/lib/auth/session"
import { redirect } from "next/navigation"
import Link from "next/link"
import {
  Building2,
  ArrowUpRight,
  Activity,
  Cpu,
  Layers,
  Database,
  CreditCard,
  TrendingUp,
  Zap,
  HardDrive,
  RefreshCw,
  CheckCircle2,
  Shield,
  Users,
  AlertTriangle,
  Smartphone,
  BookOpen
} from "lucide-react"

export const dynamic = "force-dynamic"

export default async function DashboardPage() {
  const sessionContext = await getSessionUser()
  if (!sessionContext) {
    redirect("/login")
  }

  const { user } = sessionContext

  // 1. SUPER ADMIN VIEW (SaaS Business & Operations Console)
  if (user.role === "super_admin") {
    const allTenants = await db
      .select()
      .from(tenants)
      .orderBy(desc(tenants.updatedAt))

    const total = allTenants.length
    const connected = allTenants.filter((t) => t.status === "connected").length

    // Assign mock plan names and pricing for business visualization
    const tenantsWithPlans = allTenants.map((t, idx) => {
      const plans = [
        { name: "Premium Plan", price: "Rp 1.500.000", amount: 1500000 },
        { name: "Basic Plan", price: "Rp 750.000", amount: 750000 },
        { name: "Free Trial", price: "Rp 0", amount: 0 }
      ]
      const plan = plans[idx % plans.length]
      return {
        ...t,
        planName: plan.name,
        planPrice: plan.price,
        planAmount: plan.amount,
        billingCycle: "Bulanan",
      }
    })

    // Calculate mock total MRR
    const totalMRR = tenantsWithPlans
      .filter((t) => t.status === "connected")
      .reduce((sum, t) => sum + t.planAmount, 0)

    const formattedMRR = new Intl.NumberFormat("id-ID", {
      style: "currency",
      currency: "IDR",
      maximumFractionDigits: 0
    }).format(totalMRR)

    return (
      <div className="space-y-8 animate-fade-in">
        {/* Banner Welcome */}
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-primary via-foreground to-foreground/75 bg-clip-text text-transparent flex items-center gap-2">
              <Shield className="size-8 text-primary shrink-0" />
              SaaS Admin Central
            </h1>
            <p className="text-muted-foreground mt-1">
              Konsol Manajemen Bisnis, Tenant, & Infrastruktur NextLib Cloud
            </p>
          </div>
          <div className="text-xs px-3.5 py-2 bg-primary/10 border border-primary/20 text-primary font-bold rounded-full w-fit uppercase tracking-wider shadow-sm">
            Platform Operator Account
          </div>
        </div>

        {/* Business KPI Cards */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card className="relative overflow-hidden bg-background/40 backdrop-blur border-border/80 hover:border-primary/40 transition-all shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Monthly Recurring Revenue</CardTitle>
              <div className="p-2 bg-primary/10 rounded-lg text-primary">
                <CreditCard className="size-4" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold tracking-tight text-primary">{formattedMRR}</div>
              <p className="text-[10px] text-muted-foreground mt-1 flex items-center gap-1">
                <TrendingUp className="size-3 text-emerald-500" />
                <span className="text-emerald-500 font-semibold">+15.2%</span> dibanding bulan lalu
              </p>
            </CardContent>
          </Card>

          <Card className="relative overflow-hidden bg-background/40 backdrop-blur border-border/80 hover:border-blue-500/40 transition-all shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Active Subscriptions</CardTitle>
              <div className="p-2 bg-blue-500/10 rounded-lg text-blue-500">
                <Users className="size-4" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold tracking-tight">{total} Tenant</div>
              <p className="text-[10px] text-muted-foreground mt-1">
                {connected} Connected SLiMS | {total - connected} Pending
              </p>
            </CardContent>
          </Card>

          <Card className="relative overflow-hidden bg-background/40 backdrop-blur border-border/80 hover:border-orange-500/40 transition-all shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Platform API Requests</CardTitle>
              <div className="p-2 bg-orange-500/10 rounded-lg text-orange-500">
                <Zap className="size-4" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold tracking-tight">84.320 req</div>
              <p className="text-[10px] text-muted-foreground mt-1 flex items-center gap-1">
                <CheckCircle2 className="size-3 text-emerald-500" />
                <span className="text-emerald-500 font-semibold">99,98%</span> request success rate
              </p>
            </CardContent>
          </Card>

          <Card className="relative overflow-hidden bg-background/40 backdrop-blur border-border/80 hover:border-green-500/40 transition-all shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">System Engine Status</CardTitle>
              <div className="p-2 bg-green-500/10 rounded-lg text-green-500">
                <Cpu className="size-4" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold tracking-tight text-green-500">Normal</div>
              <p className="text-[10px] text-muted-foreground mt-1">
                RAM: 42% | CPU: 12% | Disk: 28%
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Main Section */}
        <div className="grid gap-6 lg:grid-cols-3">
          {/* Subscription details */}
          <Card className="lg:col-span-2 bg-background/40 backdrop-blur border-border/80 shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="text-lg font-bold">Billing & Tenant Subscriptions</CardTitle>
                <CardDescription>Status kontrak paket langganan institusi terdaftar</CardDescription>
              </div>
              <Link
                href="/tenants"
                className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline bg-primary/10 px-2.5 py-1.5 rounded-lg border border-primary/15 transition-all"
              >
                Kelola Tenant <ArrowUpRight className="size-3.5" />
              </Link>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead className="text-xs text-muted-foreground border-b uppercase bg-muted/30">
                    <tr>
                      <th className="py-3 px-4 font-semibold">Nama Institusi</th>
                      <th className="py-3 px-4 font-semibold">Paket Layanan</th>
                      <th className="py-3 px-4 font-semibold">Biaya</th>
                      <th className="py-3 px-4 font-semibold">Status Sync</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {tenantsWithPlans.map((t) => (
                      <tr key={t.id} className="hover:bg-muted/10 transition-colors">
                        <td className="py-4 px-4">
                          <span className="font-semibold block text-foreground">{t.name}</span>
                          <span className="text-[10px] text-muted-foreground font-mono">{t.slug}</span>
                        </td>
                        <td className="py-4 px-4">
                          <Badge variant="outline" className="text-xs bg-background">
                            {t.planName}
                          </Badge>
                        </td>
                        <td className="py-4 px-4 font-medium text-foreground">
                          {t.planPrice}
                          <span className="text-[10px] text-muted-foreground block">{t.billingCycle}</span>
                        </td>
                        <td className="py-4 px-4">
                          {t.status === "connected" ? (
                            <Badge className="bg-emerald-500/10 text-emerald-500 border-emerald-500/20 text-xs font-semibold">
                              Connected
                            </Badge>
                          ) : (
                            <Badge className="bg-amber-500/10 text-amber-500 border-amber-500/20 text-xs font-semibold">
                              Pending Setup
                            </Badge>
                          )}
                        </td>
                      </tr>
                    ))}
                    {allTenants.length === 0 && (
                      <tr>
                        <td colSpan={4} className="py-8 text-center text-muted-foreground">
                          Belum ada tenant langganan aktif.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {/* Infrastructure Health & Diagnostics */}
          <div className="space-y-6">
            <Card className="bg-background/40 backdrop-blur border-border/80 shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg font-bold flex items-center gap-2">
                  <Layers className="size-5 text-primary" />
                  Infrastruktur Health
                </CardTitle>
                <CardDescription>Status resource server utama</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Memory Bar */}
                <div className="space-y-1.5">
                  <div className="flex justify-between text-xs font-medium">
                    <span className="text-muted-foreground flex items-center gap-1.5">
                      <HardDrive className="size-3.5 text-primary" />
                      Memory RAM Usage
                    </span>
                    <span className="text-foreground">42% (6.7 GB / 16 GB)</span>
                  </div>
                  <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
                    <div className="h-full bg-primary rounded-full transition-all" style={{ width: "42%" }} />
                  </div>
                </div>

                {/* CPU Bar */}
                <div className="space-y-1.5">
                  <div className="flex justify-between text-xs font-medium">
                    <span className="text-muted-foreground flex items-center gap-1.5">
                      <Cpu className="size-3.5 text-primary" />
                      CPU Processor Load
                    </span>
                    <span className="text-foreground">12% (1.2 Load Avg)</span>
                  </div>
                  <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
                    <div className="h-full bg-primary rounded-full transition-all" style={{ width: "12%" }} />
                  </div>
                </div>

                {/* Storage Bar */}
                <div className="space-y-1.5">
                  <div className="flex justify-between text-xs font-medium">
                    <span className="text-muted-foreground flex items-center gap-1.5">
                      <Database className="size-3.5 text-primary" />
                      Storage Disk Space
                    </span>
                    <span className="text-foreground">28% (22.4 GB / 80 GB)</span>
                  </div>
                  <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
                    <div className="h-full bg-primary rounded-full transition-all" style={{ width: "28%" }} />
                  </div>
                </div>

                <div className="pt-2 border-t text-xs space-y-2 text-muted-foreground">
                  <div className="flex justify-between">
                    <span>Database Pool:</span>
                    <span className="font-semibold text-foreground">15 / 100 conns</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Redis Cache Hit Rate:</span>
                    <span className="font-semibold text-foreground">99.4%</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Engine Version:</span>
                    <span className="font-mono">v1.2.0</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Audit Log Activities */}
            <Card className="bg-background/40 backdrop-blur border-border/80 shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-bold flex items-center justify-between">
                  <span>Audit Logs</span>
                  <span className="text-[10px] text-muted-foreground font-normal flex items-center gap-1">
                    <RefreshCw className="size-2.5 animate-spin" /> Real-time
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="text-xs space-y-3">
                <div className="flex items-start gap-2.5 pb-2 border-b border-border/50">
                  <span className="size-2 rounded-full bg-emerald-500 mt-1.5 shrink-0" />
                  <div>
                    <p className="text-foreground">Tenant <strong>Universitas NextLib</strong> API sync success</p>
                    <span className="text-[9px] text-muted-foreground">10 menit yang lalu</span>
                  </div>
                </div>
                <div className="flex items-start gap-2.5 pb-2 border-b border-border/50">
                  <span className="size-2 rounded-full bg-blue-500 mt-1.5 shrink-0" />
                  <div>
                    <p className="text-foreground">WhatsApp session connected JID mapping confirmed</p>
                    <span className="text-[9px] text-muted-foreground">2 jam yang lalu</span>
                  </div>
                </div>
                <div className="flex items-start gap-2.5">
                  <span className="size-2 rounded-full bg-amber-500 mt-1.5 shrink-0" />
                  <div>
                    <p className="text-foreground">New tenant registration created: <code>universitas-nextlib</code></p>
                    <span className="text-[9px] text-muted-foreground">1 hari yang lalu</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    )
  }

  // 2. SCOPED VIEW (TENANT ADMIN & LIBRARIAN)
  const tenantId = user.tenantId
  if (!tenantId) {
    return (
      <div className="p-8 text-center border border-dashed rounded-xl bg-background/50 flex flex-col items-center justify-center space-y-4">
        <Shield className="size-12 text-destructive" />
        <h2 className="text-xl font-bold text-foreground">User Scoping Error</h2>
        <p className="text-muted-foreground max-w-md">
          Akun Anda tidak terhubung dengan tenant (institusi) mana pun. Silakan hubungi Super Admin NextLib untuk mendaftarkan institusi Anda.
        </p>
      </div>
    )
  }

  // Fetch tenant details
  const [tenant] = await db
    .select()
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1)

  if (!tenant) {
    return (
      <div className="p-8 text-center border border-dashed rounded-xl bg-background/50 flex flex-col items-center justify-center space-y-4">
        <Shield className="size-12 text-destructive" />
        <h2 className="text-xl font-bold text-foreground">Tenant Not Found</h2>
        <p className="text-muted-foreground">
          Tenant dengan ID yang terasosiasi tidak ditemukan.
        </p>
      </div>
    )
  }

  // Fetch latest daily stats (v2)
  const [latestStats] = await db
    .select()
    .from(dailyStatsV2)
    .where(eq(dailyStatsV2.tenantId, tenantId))
    .orderBy(desc(dailyStatsV2.date))
    .limit(1)

  // Fetch WA messages stats
  const waLogs = await db
    .select({
      direction: waMessageLog.direction,
      intentType: waMessageLog.intentType,
    })
    .from(waMessageLog)
    .where(eq(waMessageLog.tenantId, tenantId))

  const totalIncoming = waLogs.filter((l) => l.direction === "incoming").length
  const totalOutgoing = waLogs.filter((l) => l.direction === "outgoing").length
  const totalFaq = waLogs.filter((l) => l.intentType === "faq").length
  const totalCirculation = waLogs.filter((l) => l.intentType === "circulation").length

  // WhatsApp session
  const [waSession] = await db
    .select()
    .from(whatsappSessions)
    .where(eq(whatsappSessions.tenantId, tenantId))
    .limit(1)

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Banner Welcome */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-primary/10 via-primary/5 to-transparent border p-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="space-y-1">
          <span className="text-xs font-semibold text-primary uppercase tracking-wider">nextlib cloud portal</span>
          <h1 className="text-2xl font-bold text-foreground md:text-3xl">
            {tenant.name}
          </h1>
          <p className="text-sm text-muted-foreground">
            Layanan AI Virtual Librarian Engine & Sinkronisasi SLiMS
          </p>
        </div>
        <div className="flex flex-col gap-1.5 text-xs bg-background/80 backdrop-blur border p-3 rounded-lg w-fit">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-muted-foreground">User:</span>
            <span className="font-medium text-foreground">{user.name}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="font-semibold text-muted-foreground">Hak Akses:</span>
            <Badge className="bg-primary/10 text-primary border-primary/20 text-[10px] uppercase font-bold px-1.5 py-0">
              {user.role.replace("_", " ")}
            </Badge>
          </div>
        </div>
      </div>

      {/* SLiMS Stats Section */}
      <div>
        <h2 className="text-lg font-bold text-foreground mb-4 flex items-center gap-2">
          <Activity className="size-5 text-primary" />
          SLiMS Library Metrics
          {latestStats && (
            <span className="text-xs font-normal text-muted-foreground">
              (Terakhir Sinkron: {new Date(latestStats.receivedAt).toLocaleString("id-ID")})
            </span>
          )}
        </h2>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card className="bg-background/50 backdrop-blur">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Total Pengunjung Hari Ini</CardTitle>
              <Users className="size-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-extrabold">{latestStats?.visitorCount ?? 0}</div>
              <p className="text-xs text-muted-foreground mt-1">
                {latestStats?.uniqueVisitorCount ?? 0} pengunjung unik
              </p>
            </CardContent>
          </Card>

          <Card className="bg-background/50 backdrop-blur">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Peminjaman Hari Ini</CardTitle>
              <BookOpen className="size-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-extrabold">{latestStats?.loanCount ?? 0}</div>
              <p className="text-xs text-muted-foreground mt-1">
                Pengembalian hari ini: {latestStats?.returnCount ?? 0} buku
              </p>
            </CardContent>
          </Card>

          <Card className="bg-background/50 backdrop-blur">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Total Anggota Aktif</CardTitle>
              <Users className="size-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-extrabold">{latestStats?.activeMemberCount ?? 0}</div>
              <p className="text-xs text-muted-foreground mt-1">
                Anggota baru hari ini: {latestStats?.newMemberCount ?? 0}
              </p>
            </CardContent>
          </Card>

          <Card className="bg-background/50 backdrop-blur">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Total Koleksi Buku</CardTitle>
              <Database className="size-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-extrabold">{latestStats?.totalCollectionSize ?? 0}</div>
              <p className="text-xs text-muted-foreground mt-1">
                Entri bibliografi baru: {latestStats?.newBiblioCount ?? 0}
              </p>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* AI Librarian / WhatsApp Gateway Section */}
      <div className="grid gap-6 md:grid-cols-3">
        <Card className="md:col-span-2 bg-background/50 backdrop-blur">
          <CardHeader>
            <CardTitle className="text-lg font-bold flex items-center justify-between">
              <span>AI Virtual Librarian Metrics (WhatsApp)</span>
              <Badge className="bg-blue-500/10 text-blue-500 border-blue-500/20 text-xs font-semibold">
                DeepSeek Engine v2
              </Badge>
            </CardTitle>
            <CardDescription>Grafik dan total interaksi WhatsApp chatbot perpustakaan</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="p-4 rounded-xl border bg-muted/30">
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block mb-1">Pesan Masuk (Incoming)</span>
                <span className="text-3xl font-extrabold text-foreground">{totalIncoming}</span>
                <p className="text-xs text-muted-foreground mt-1">Chat dari mahasiswa / pembaca</p>
              </div>
              <div className="p-4 rounded-xl border bg-muted/30">
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block mb-1">Pesan Keluar (Auto-Replies)</span>
                <span className="text-3xl font-extrabold text-foreground">{totalOutgoing}</span>
                <p className="text-xs text-muted-foreground mt-1">Jawaban AI & reminder otomatis</p>
              </div>
            </div>

            <div className="border-t pt-4 space-y-3">
              <h4 className="text-sm font-bold text-foreground">Intent Classifications</h4>
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="flex items-center justify-between text-xs p-2 bg-muted/40 rounded border">
                  <span className="text-muted-foreground flex items-center gap-1.5">
                    <span className="size-2 rounded-full bg-primary inline-block"></span>
                    FAQ Informasi Umum
                  </span>
                  <span className="font-semibold text-foreground">{totalFaq} hit</span>
                </div>
                <div className="flex items-center justify-between text-xs p-2 bg-muted/40 rounded border">
                  <span className="text-muted-foreground flex items-center gap-1.5">
                    <span className="size-2 rounded-full bg-blue-500 inline-block"></span>
                    Informasi Peminjaman / Buku
                  </span>
                  <span className="font-semibold text-foreground">{totalCirculation} hit</span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* WhatsApp Connection Status Card */}
        <Card className="bg-background/50 backdrop-blur flex flex-col justify-between">
          <div>
            <CardHeader>
              <CardTitle className="text-lg font-bold">WhatsApp Session</CardTitle>
              <CardDescription>Status koneksi device WA Gateway</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-3">
                <div className={`p-2 rounded-lg ${waSession?.status === "connected" ? "bg-green-500/10 text-green-500" : "bg-yellow-500/10 text-yellow-500"}`}>
                  <Smartphone className="size-5" />
                </div>
                <div>
                  <span className="text-xs font-semibold text-muted-foreground block">Device Status</span>
                  {waSession?.status === "connected" ? (
                    <Badge className="bg-green-500/10 text-green-500 border-green-500/20 text-xs font-bold mt-0.5">
                      Connected
                    </Badge>
                  ) : (
                    <Badge className="bg-yellow-500/10 text-yellow-500 border-yellow-500/20 text-xs font-bold mt-0.5">
                      Disconnected
                    </Badge>
                  )}
                </div>
              </div>

              {waSession?.phoneNumber && (
                <div className="border-t pt-3 space-y-1">
                  <span className="text-xs text-muted-foreground font-semibold">Phone Number:</span>
                  <p className="text-sm font-semibold text-foreground">{waSession.phoneNumber}</p>
                </div>
              )}

              {latestStats?.anomalyFlags && latestStats.anomalyFlags.length > 0 && (
                <div className="border-t pt-3">
                  <span className="text-xs text-amber-500 font-semibold flex items-center gap-1 mb-1">
                    <AlertTriangle className="size-3.5" />
                    Anomaly Flagged:
                  </span>
                  <div className="flex flex-wrap gap-1">
                    {latestStats.anomalyFlags.map((flag, i) => (
                      <Badge key={i} variant="destructive" className="text-[10px] px-1 py-0 font-normal">
                        {flag}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </div>

          <CardContent className="border-t pt-4">
            <Link
              href="/whatsapp"
              className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow hover:bg-primary/90 transition-colors"
            >
              Config WhatsApp & KB <ArrowUpRight className="size-4" />
            </Link>
          </CardContent>
        </Card>
      </div>

      {/* Getting Started / Info for Tenant Users */}
      {latestStats == null && (
        <Card className="bg-amber-500/5 border-amber-500/20">
          <CardHeader className="pb-2">
            <CardTitle className="text-base text-amber-500 flex items-center gap-2 font-bold">
              <AlertTriangle className="size-5" />
              SLiMS Data Belum Tersinkronisasi
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground space-y-2">
            <p>NextLib Cloud belum mendeteksi adanya data sync yang dikirimkan oleh plugin SLiMS kampus Anda.</p>
            <p>Langkah penyelesaian:</p>
            <ol className="list-decimal list-inside space-y-1 pl-1">
              <li>Pastikan SLiMS plugin terpasang dengan baik (Download plugin di menu <strong>Koneksi</strong>).</li>
              <li>Masukkan API URL & Secret Token kampus yang didapatkan dari halaman <strong>Koneksi</strong>.</li>
              <li>Jalankan cronjob / scheduler di server SLiMS Anda untuk sync data harian ke NextLib Cloud.</li>
            </ol>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
