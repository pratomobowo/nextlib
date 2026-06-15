"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Download, Library } from "lucide-react"
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  PieChart, Pie, Cell, Legend,
} from "recharts"
import { downloadAnalyticsCsv } from "@/lib/analytics/export"

interface DdcEntry { class: string; label: string; titles: number; items: number }
interface CollectionType { type_name: string; items: number }
interface CollectionData {
  ddc: DdcEntry[]
  totals: {
    total_titles: number
    total_items: number
    borrowed_titles: number
    borrowed_items: number
    never_borrowed_items: number
    borrowed_titles_pct: number
  }
  collection_types: CollectionType[]
}

const PIE_COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6", "#6366f1", "#f97316", "#84cc16", "#6b7280"]

export function CollectionPanel() {
  const [data, setData] = useState<CollectionData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true); setError(null)
      try {
        const res = await fetch("/api/v1/analytics/collection", { cache: "no-store" })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const json = (await res.json()) as CollectionData
        if (!cancelled) setData(json)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Gagal memuat data")
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [])

  if (error) return <p className="text-sm text-destructive">{error}</p>
  if (loading || !data) {
    return <Skeleton className="h-96 w-full" />
  }

  const t = data.totals
  return (
    <div className="space-y-4">
      {/* Totals cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <TotalCard label="Total Judul" value={t.total_titles} />
        <TotalCard label="Total Eksemplar" value={t.total_items} />
        <TotalCard label="Judul Pernah Dipinjam" value={t.borrowed_titles} sub={`${t.borrowed_titles_pct}%`} />
        <TotalCard label="Eksemplar Dipinjam" value={t.borrowed_items} />
        <TotalCard label="Tak Pernah Dipinjam" value={t.never_borrowed_items} />
      </div>

      {/* DDC Bar chart */}
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="flex items-center gap-2 text-base">
            <Library className="h-4 w-4" />
            Distribusi Koleksi per Klasifikasi DDC
          </CardTitle>
          <Button variant="outline" size="sm" onClick={() => downloadAnalyticsCsv("collection")}>
            <Download className="h-3.5 w-3.5 mr-1" /> CSV
          </Button>
        </CardHeader>
        <CardContent>
          <div style={{ height: 360 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.ddc} layout="vertical" margin={{ left: 20, right: 30 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis
                  type="category"
                  dataKey="class"
                  tick={{ fontSize: 11 }}
                  width={50}
                />
                <Tooltip
                  formatter={(value) => [Number(value).toLocaleString("id-ID"), ""]}
                  labelFormatter={(_, payload) => {
                    const entry = payload?.[0]?.payload as DdcEntry | undefined
                    return entry ? `${entry.class} — ${entry.label}` : ""
                  }}
                />
                <Legend formatter={(v) => (v === "titles" ? "Judul" : "Eksemplar")} />
                <Bar dataKey="titles" fill="#3b82f6" radius={[0, 4, 4, 0]} />
                <Bar dataKey="items" fill="#10b981" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* Collection types pie */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Distribusi Tipe Koleksi</CardTitle>
        </CardHeader>
        <CardContent>
          <div style={{ height: 280 }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data.collection_types}
                  dataKey="items"
                  nameKey="type_name"
                  cx="50%"
                  cy="50%"
                  outerRadius={90}
                  label={(entry: unknown) => {
                    const e = entry as { type_name?: string; items?: number }
                    return `${e.type_name ?? ""} (${e.items ?? 0})`
                  }}
                  labelLine={false}
                >
                  {data.collection_types.map((_, i) => (
                    <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(value) => Number(value).toLocaleString("id-ID")} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function TotalCard({ label, value, sub }: { label: string; value: number; sub?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-2xl font-bold">{value.toLocaleString("id-ID")}</p>
        {sub && <p className="text-[10px] text-muted-foreground">{sub}</p>}
      </CardContent>
    </Card>
  )
}
