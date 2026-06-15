"use client"

import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  Download,
  Rocket,
  Settings2,
  Boxes,
  HelpCircle,
  ShieldCheck,
  Terminal,
  Plug,
  Database,
  Bot,
  Search,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react"

/**
 * PanduanPanel
 *
 * Single source of truth for platform documentation shown inside the dashboard.
 * Tabbed so the user can jump between Overview, Plugin Install (incl. the zip
 * download for SLiMS), Configuration, Modules, and FAQ.
 *
 * Content lives in this file (no CMS) so it ships with the app and stays versioned
 * alongside the code it documents.
 */
export function PanduanPanel() {
  return (
    <Tabs defaultValue="overview" className="gap-4">
      <TabsList className="h-auto flex-wrap">
        <TabsTrigger value="overview">
          <Rocket className="size-4" />
          Overview
        </TabsTrigger>
        <TabsTrigger value="install">
          <Download className="size-4" />
          Instalasi Plugin
        </TabsTrigger>
        <TabsTrigger value="config">
          <Settings2 className="size-4" />
          Konfigurasi
        </TabsTrigger>
        <TabsTrigger value="modules">
          <Boxes className="size-4" />
          Modul & Fitur
        </TabsTrigger>
        <TabsTrigger value="faq">
          <HelpCircle className="size-4" />
          FAQ
        </TabsTrigger>
      </TabsList>

      {/* ─── Overview ─────────────────────────────────────────── */}
      <TabsContent value="overview" className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="size-5 text-primary" />
              Privacy-First Architecture
            </CardTitle>
            <CardDescription>
              NextLib mematuhi UU PDP — data pribadi tidak pernah meninggalkan
              kampus.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <p>
              Platform ini menjembatani SLiMS dengan otomatisasi modern tanpa
              mengkloning data sensitif. Data dibagi tiga kluster:
            </p>
            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded-lg border p-3">
                <Badge variant="destructive" className="mb-2">PII</Badge>
                <p className="text-xs">
                  Nama, NIM, riwayat pinjam — <strong>tidak disimpan</strong> di
                  cloud. Hanya lewat di memori saat request, lalu dibuang.
                </p>
              </div>
              <div className="rounded-lg border p-3">
                <Badge variant="secondary" className="mb-2">Agregat</Badge>
                <p className="text-xs">
                  Jumlah pengunjung, total pinjam, denda kolektif —{" "}
                  <strong>disimpan</strong> untuk analitik &amp; borang.
                </p>
              </div>
              <div className="rounded-lg border p-3">
                <Badge className="mb-2">Kredensial</Badge>
                <p className="text-xs">
                  API key, base URL — <strong>terenkripsi</strong> AES-256-GCM
                  di database cloud.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Plug className="size-4 text-primary" />
                NextLib-Agent
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              Plugin PHP yang dipasang di folder <code className="text-xs">plugins/</code>{" "}
              SLiMS. Mendaftarkan API endpoint terproteksi HMAC &amp; export
              statistik agregat harian. Tanpa modifikasi core SLiMS.
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Database className="size-4 text-primary" />
                NextLib-Cloud
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              Server SaaS pusat (Next.js). Multi-tenant dashboard analitik, API
              router ke SLiMS, WhatsApp AI librarian, dan federated search.
            </CardContent>
          </Card>
        </div>
      </TabsContent>

      {/* ─── Instalasi Plugin ─────────────────────────────────── */}
      <TabsContent value="install" className="space-y-4">
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Download className="size-5 text-primary" />
                <h3 className="font-semibold">Plugin SLiMS — nextlib-agent.zip</h3>
              </div>
              <p className="text-sm text-muted-foreground">
                Unduh plugin, ekstrak ke folder <code className="text-xs">plugins/</code>{" "}
                SLiMS kampus, lalu ikuti langkah konfigurasi di bawah.
              </p>
            </div>
            <a
              href="/downloads/nextlib-agent.zip"
              download
              className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
            >
              <Download className="size-4" />
              Unduh nextlib-agent.zip
            </a>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Terminal className="size-4 text-primary" />
              Langkah-Langkah Instalasi
            </CardTitle>
            <CardDescription>
              Kompatibel dengan SLiMS 9 Bulian+ dan PHP 7.4 / 8.0 / 8.1 / 8.2.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ol className="space-y-4">
              <InstallStep
                n={1}
                title="Daftarkan tenant di NextLib-Cloud"
                body={
                  <>
                    Login sebagai <strong>Tenant Admin</strong> lalu buat tenant
                    kampus. Anda akan mendapatkan <code className="text-xs">tenant_id</code>{" "}
                    dan <code className="text-xs">token_secret</code> untuk HMAC.
                  </>
                }
              />
              <InstallStep
                n={2}
                title="Unduh & ekstrak plugin"
                body={
                  <>
                    Klik tombol <em>Unduh nextlib-agent.zip</em> di atas, lalu
                    ekstrak ke direktori:
                    <pre className="mt-2 overflow-x-auto rounded-md bg-muted p-3 text-xs"><code>/path/slims/plugins/nextlib-agent/</code></pre>
                  </>
                }
              />
              <InstallStep
                n={3}
                title="Pasang dependensi (Composer)"
                body={
                  <>
                    Jalankan di dalam folder plugin:
                    <pre className="mt-2 overflow-x-auto rounded-md bg-muted p-3 text-xs"><code>{`composer install --no-dev --optimize-autoloader`}</code></pre>
                    <p className="mt-2">
                      Ini memasang <code className="text-xs">vlucas/phpdotenv</code>{" "}
                      untuk membaca file <code className="text-xs">.env</code>.
                    </p>
                  </>
                }
              />
              <InstallStep
                n={4}
                title="Konfigurasi .env"
                body={
                  <>
                    Salin <code className="text-xs">.env.example</code> menjadi{" "}
                    <code className="text-xs">.env</code> dan isi kredensial dari
                    langkah 1. Detail lengkap ada di tab{" "}
                    <strong>Konfigurasi</strong>.
                  </>
                }
              />
              <InstallStep
                n={5}
                title="Verifikasi koneksi (handshake)"
                body={
                  <>
                    Buka menu <strong>Koneksi</strong> di dashboard — status harus
                    berubah menjadi <Badge className="ml-1">Connected</Badge>.
                    Cloud akan melakukan ping HMAC ke endpoint{" "}
                    <code className="text-xs">/api/v1/nextlib/handshake</code>{" "}
                    SLiMS.
                  </>
                }
              />
              <InstallStep
                n={6}
                title="Aktifkan cron export agregat"
                body={
                  <>
                    Tambahkan ke crontab server SLiMS (setiap hari jam 23:59):
                    <pre className="mt-2 overflow-x-auto rounded-md bg-muted p-3 text-xs"><code>{`59 23 * * * /usr/bin/php /path/slims/plugins/nextlib-agent/cron.php`}</code></pre>
                  </>
                }
              />
            </ol>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="size-4 text-primary" />
              Catatan Keamanan
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <ul className="space-y-1.5">
              <li className="flex gap-2">
                <CheckCircle2 className="size-4 shrink-0 text-green-600" />
                Semua API endpoint dilindungi HMAC-SHA256 + token kedaluwarsa 5 menit.
              </li>
              <li className="flex gap-2">
                <CheckCircle2 className="size-4 shrink-0 text-green-600" />
                <code className="text-xs">.htaccess</code> menolak akses langsung ke file PHP &amp; <code className="text-xs">.env</code>.
              </li>
              <li className="flex gap-2">
                <AlertTriangle className="size-4 shrink-0 text-yellow-600" />
                Jangan commit <code className="text-xs">.env</code> berisi secret asli — selalu gitignored.
              </li>
            </ul>
          </CardContent>
        </Card>
      </TabsContent>

      {/* ─── Konfigurasi ──────────────────────────────────────── */}
      <TabsContent value="config" className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Settings2 className="size-4 text-primary" />
              Variabel Environment (.env)
            </CardTitle>
            <CardDescription>
              Dibaca oleh plugin via phpdotenv. Semua nilai fallback aman.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-hidden rounded-lg border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr className="text-left">
                    <th className="px-3 py-2 font-medium">Variabel</th>
                    <th className="px-3 py-2 font-medium">Wajib</th>
                    <th className="px-3 py-2 font-medium">Keterangan</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  <ConfigRow name="NEXTLIB_TOKEN_SECRET" required desc="Secret key HMAC-SHA256 dari onboarding cloud." />
                  <ConfigRow name="NEXTLIB_CLOUD_URL" required desc="Base URL NextLib-Cloud (HTTPS di produksi)." />
                  <ConfigRow name="NEXTLIB_TENANT_ID" required desc="ID tenant dari NextLib-Cloud." />
                  <ConfigRow name="SLIMS_DB_HOST" desc="Host database SLiMS (default: localhost)." />
                  <ConfigRow name="SLIMS_DB_NAME" desc="Nama database SLiMS (default: slims)." />
                  <ConfigRow name="SLIMS_DB_USER" desc="User database SLiMS." />
                  <ConfigRow name="SLIMS_DB_PASS" desc="Password database SLiMS." />
                  <ConfigRow name="SLIMS_DB_PORT" desc="Port database (default: 3306)." />
                  <ConfigRow name="NEXTLIB_TOKEN_MAX_AGE" desc="Kedaluwarsa token detik (default: 300)." />
                  <ConfigRow name="NEXTLIB_HTTP_TIMEOUT" desc="Timeout HTTP detik (default: 5)." />
                  <ConfigRow name="NEXTLIB_DEBUG" desc="Mode debug, 1/0 (default: 0)." />
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Contoh .env</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="overflow-x-auto rounded-md bg-muted p-4 text-xs leading-relaxed"><code>{`# Kredensial dari NextLib-Cloud (onboarding)
NEXTLIB_TOKEN_SECRET=hasil-dari-openssl-rand-hex-32
NEXTLIB_CLOUD_URL=https://cloud.nextlib.id
NEXTLIB_TENANT_ID=12345678-abcd-...

# Koneksi database SLiMS lokal
SLIMS_DB_HOST=localhost
SLIMS_DB_NAME=slims
SLIMS_DB_USER=slims_user
SLIMS_DB_PASS=rahasia
SLIMS_DB_PORT=3306

# Opsional
NEXTLIB_DEBUG=0`}</code></pre>
          </CardContent>
        </Card>
      </TabsContent>

      {/* ─── Modul & Fitur ────────────────────────────────────── */}
      <TabsContent value="modules" className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          <ModuleCard
            icon={Plug}
            title="A. NextLib-Agent"
            tag="SLiMS Plugin"
            items={[
              "Zero core modification — murni di folder plugins/",
              "API endpoint terproteksi HMAC: search-book, member-check, extend-book",
              "Library analytics: top-books, dead-stock, collection-stats, member-activity",
              "Export agregat harian via cron dengan retry queue",
            ]}
          />
          <ModuleCard
            icon={Database}
            title="B. NextLib-Cloud"
            tag="SaaS Server"
            items={[
              "Multi-tenant dengan isolasi data tenant_id",
              "API router stateless ke SLiMS (in-memory, tanpa simpan PII)",
              "Dashboard analitik & generator borang akreditasi (.xlsx/.pdf)",
            ]}
          />
          <ModuleCard
            icon={Bot}
            title="C. AI Virtual Librarian"
            tag="WhatsApp"
            items={[
              "WhatsApp gateway multi-tenant (scan QR per kampus)",
              "Intent classifier: FAQ vs query sirkulasi",
              "Natural formatting jawaban via LLM (OpenAI/Ollama)",
              "Knowledge base aturan kampus yang di-upload",
            ]}
          />
          <ModuleCard
            icon={Search}
            title="D. Federated Discovery"
            tag="Search"
            items={[
              "Konektor OAI-PMH (EPrints/DSpace) & REST/RSS (OJS)",
              "Concurrent request Promise.all untuk latency rendah",
              "Normalisasi JSON/ XML/RSS ke struktur seragam",
              "White-label landing page + custom domain (CNAME)",
            ]}
          />
        </div>
      </TabsContent>

      {/* ─── FAQ ──────────────────────────────────────────────── */}
      <TabsContent value="faq" className="space-y-4">
        <Card>
          <CardContent className="space-y-4 pt-6">
            <FaqItem
              q="Apakah plugin mengubah core SLiMS?"
              a="Tidak. NextLib-Agent berjalan murni sebagai ekstensi di folder plugins/. Tidak ada satu baris core SLiMS yang dimodifikasi."
            />
            <FaqItem
              q="Apakah data mahasiswa (NIM, nama, riwayat) tersimpan di cloud?"
              a="Tidak. Sesuai arsitektur Privacy-First, PII hanya berada di database SLiMS lokal. Cloud hanya menerima agregat anonim (jumlah, total) yang di-push via cron."
            />
            <FaqItem
              q="Bagaimana jika server SLiMS kampus sedang mati?"
              a="API timeout dibatasi 5 detik. Sistem merespons dengan pesan fallback yang sopan, dan export yang gagal masuk retry queue untuk dikirim ulang otomatis."
            />
            <FaqItem
              q="Versi PHP apa yang didukung?"
              a="Plugin kompatibel PHP 7.4, 8.0, 8.1, dan 8.2. SLiMS 9 Bulian atau lebih baru."
            />
            <FaqItem
              q="Status koneksi masih Pending, apa yang salah?"
              a="Periksa: (1) file .env sudah terisi benar, (2) vendor/autoload.php ada setelah composer install, (3) endpoint /api/v1/nextlib/handshake reachable dari cloud. Lihat tab Koneksi untuk status real-time."
            />
            <FaqItem
              q="Bagaimana cara update plugin ke versi baru?"
              a="Unduh ulang zip terbaru dari tab Instalasi Plugin, timpa folder plugins/nextlib-agent, jalankan composer install ulang, dan restart. Konfigurasi .env tidak terpengaruh."
            />
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  )
}

/* ─── Sub-components ────────────────────────────────────────── */

function InstallStep({
  n,
  title,
  body,
}: {
  n: number
  title: string
  body: React.ReactNode
}) {
  return (
    <li className="flex gap-3">
      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
        {n}
      </span>
      <div className="space-y-1 pt-0.5">
        <p className="font-medium leading-none">{title}</p>
        <div className="text-sm text-muted-foreground">{body}</div>
      </div>
    </li>
  )
}

function ConfigRow({
  name,
  desc,
  required = false,
}: {
  name: string
  desc: string
  required?: boolean
}) {
  return (
    <tr>
      <td className="px-3 py-2 font-mono text-xs">{name}</td>
      <td className="px-3 py-2">
        {required ? (
          <Badge variant="destructive" className="text-[10px]">Wajib</Badge>
        ) : (
          <Badge variant="outline" className="text-[10px]">Opsional</Badge>
        )}
      </td>
      <td className="px-3 py-2 text-xs text-muted-foreground">{desc}</td>
    </tr>
  )
}

function ModuleCard({
  icon: Icon,
  title,
  tag,
  items,
}: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  tag: string
  items: string[]
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <Icon className="size-4 text-primary" />
            {title}
          </CardTitle>
          <Badge variant="secondary" className="text-[10px]">{tag}</Badge>
        </div>
      </CardHeader>
      <CardContent>
        <ul className="space-y-1.5 text-sm text-muted-foreground">
          {items.map((item) => (
            <li key={item} className="flex gap-2">
              <CheckCircle2 className="size-4 shrink-0 text-green-600" />
              {item}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}

function FaqItem({ q, a }: { q: string; a: string }) {
  return (
    <div className="space-y-1.5 rounded-lg border p-4">
      <p className="flex items-start gap-2 font-medium">
        <HelpCircle className="size-4 shrink-0 text-primary" />
        {q}
      </p>
      <p className="text-sm text-muted-foreground">{a}</p>
    </div>
  )
}
