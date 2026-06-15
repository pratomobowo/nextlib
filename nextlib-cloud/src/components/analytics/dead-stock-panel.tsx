"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
import { Download, AlertTriangle, BookX } from "lucide-react"
import { downloadAnalyticsCsv } from "@/lib/analytics/export"

interface DeadStockItem {
  item_code: string
  biblio_id: number
  title: string
  classification: string
  last_loan_date: string | null
  status: "never" | "idle"
  idle_months: number | null
}

interface DeadStockSummary {
  total_dead: number
  never_borrowed: number
  idle_count: number
  total_items: number
  percentage: number
  months_idle: number
}

interface DeadStockResponse {
  items: DeadStockItem[]
  summary: DeadStockSummary
}

export function DeadStockPanel() {
  const [data, setData] = useState<DeadStockResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [monthsIdle, setMonthsIdle] = useState(12)
  const [limit, setLimit] = useState(50)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const params = new URLSearchParams({
          months_idle: String(monthsIdle),
          limit: String(limit),
        })
        const res = await fetch(`/api/v1/analytics/dead-stock?${params}`, { cache: "no-store" })
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body.message || `HTTP ${res.status}`)
        }
        const json = (await res.json()) as DeadStockResponse
        if (!cancelled) setData(json)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Gagal memuat data")
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [monthsIdle, limit])

  const summary = data?.summary

  return (
    <div className="space-y-4">
      {/* Summary cards */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <SummaryStat label="Total Dead Stock" value={summary.total_dead} sub={`${summary.percentage}% dari koleksi`} tone="warn" />
          <SummaryStat label="Tak Pernah Dipinjam" value={summary.never_borrowed} sub="sejak masuk katalog" />
          <SummaryStat label="Idle" value={summary.idle_count} sub={`>${monthsIdle} bulan tak dipinjam`} />
          <SummaryStat label="Total Koleksi" value={summary.total_items} sub="item" />
        </div>
      )}

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="flex items-center gap-2 text-base">
            <BookX className="h-4 w-4" />
            Daftar Dead Stock
          </CardTitle>
          <div className="flex items-center gap-2">
            <label className="text-xs text-muted-foreground">Idle:</label>
            <select
              value={monthsIdle}
              onChange={(e) => setMonthsIdle(Number(e.target.value))}
              className="h-8 rounded-md border border-input bg-background px-2 text-xs"
              disabled={loading}
            >
              <option value={6}>6 bulan</option>
              <option value={12}>12 bulan</option>
              <option value={24}>24 bulan</option>
              <option value={36}>36 bulan</option>
            </select>
            <select
              value={limit}
              onChange={(e) => setLimit(Number(e.target.value))}
              className="h-8 rounded-md border border-input bg-background px-2 text-xs"
              disabled={loading}
            >
              <option value={50}>50 baris</option>
              <option value={100}>100 baris</option>
              <option value={500}>500 baris</option>
            </select>
            <Button
              variant="outline"
              size="sm"
              onClick={() => downloadAnalyticsCsv("dead-stock", { months_idle: monthsIdle, limit })}
              disabled={loading || !data}
            >
              <Download className="h-3.5 w-3.5 mr-1" />
              CSV
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {error && <p className="text-sm text-destructive">{error}</p>}
          {loading && (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          )}
          {!loading && data && data.items.length === 0 && (
            <p className="text-sm text-muted-foreground py-8 text-center">
              Tidak ada dead stock pada threshold ini. 🎉
            </p>
          )}
          {!loading && data && data.items.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left border-b text-muted-foreground">
                    <th className="py-2 pr-3">Kode Item</th>
                    <th className="py-2 pr-3">Judul</th>
                    <th className="py-2 pr-3 hidden md:table-cell">Klasifikasi</th>
                    <th className="py-2 pr-3 hidden lg:table-cell">Pinjam Terakhir</th>
                    <th className="py-2 pr-3">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((it) => (
                    <tr key={it.item_code} className="border-b last:border-0 hover:bg-muted/30">
                      <td className="py-2 pr-3 font-mono text-xs">{it.item_code}</td>
                      <td className="py-2 pr-3">{it.title}</td>
                      <td className="py-2 pr-3 hidden md:table-cell">
                        {it.classification && <Badge variant="outline">{it.classification}</Badge>}
                      </td>
                      <td className="py-2 pr-3 text-muted-foreground hidden lg:table-cell">
                        {it.last_loan_date ?? "—"}
                      </td>
                      <td className="py-2 pr-3">
                        <Badge variant={it.status === "never" ? "destructive" : "secondary"}>
                          {it.status === "never" ? "Tak Pernah" : `${it.idle_months}bln idle`}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function SummaryStat({
  label,
  value,
  sub,
  tone = "default",
}: {
  label: string
  value: number
  sub?: string
  tone?: "default" | "warn"
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className={`text-2xl font-bold ${tone === "warn" ? "text-amber-600 dark:text-amber-500" : ""}`}>
          {value.toLocaleString("id-ID")}
        </p>
        {sub && <p className="text-[10px] text-muted-foreground">{sub}</p>}
      </CardContent>
    </Card>
  )
}
