"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
import { Download, BookOpen, Trophy } from "lucide-react"
import { downloadAnalyticsCsv } from "@/lib/analytics/export"

interface Book {
  biblio_id: number
  title: string
  classification: string
  isbn_issn: string
  author_names: string
  cover_image: string | null
  loan_count: number
}

interface TopBooksResponse {
  books: Book[]
  period: { start: string | null; end: string | null }
  total_loans_in_period: number
}

export interface TopBooksPanelProps {
  startDate?: string
  endDate?: string
}

export function TopBooksPanel({ startDate, endDate }: TopBooksPanelProps) {
  const [data, setData] = useState<TopBooksResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [limit, setLimit] = useState(20)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const params = new URLSearchParams({ limit: String(limit) })
        if (startDate) params.set("start_date", startDate)
        if (endDate) params.set("end_date", endDate)
        const res = await fetch(`/api/v1/analytics/top-books?${params}`, { cache: "no-store" })
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body.message || `HTTP ${res.status}`)
        }
        const json = (await res.json()) as TopBooksResponse
        if (!cancelled) setData(json)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Gagal memuat data")
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [startDate, endDate, limit])

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-2 text-base">
          <Trophy className="h-4 w-4" />
          Buku Paling Banyak Dipinjam
        </CardTitle>
        <div className="flex items-center gap-2">
          <select
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value))}
            className="h-8 rounded-md border border-input bg-background px-2 text-xs"
            disabled={loading}
          >
            <option value={10}>Top 10</option>
            <option value={20}>Top 20</option>
            <option value={50}>Top 50</option>
            <option value={100}>Top 100</option>
          </select>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              downloadAnalyticsCsv("top-books", {
                ...(startDate ? { start_date: startDate } : {}),
                ...(endDate ? { end_date: endDate } : {}),
                limit,
              })
            }
            disabled={loading || !data}
          >
            <Download className="h-3.5 w-3.5 mr-1" />
            CSV
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {error && (
          <p className="text-sm text-destructive">{error}</p>
        )}
        {loading && (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        )}
        {!loading && data && data.books.length === 0 && (
          <p className="text-sm text-muted-foreground py-8 text-center">
            Tidak ada data peminjaman pada periode ini.
          </p>
        )}
        {!loading && data && data.books.length > 0 && (
          <>
            <p className="text-xs text-muted-foreground mb-3">
              Total peminjaman periode ini: <strong>{data.total_loans_in_period}</strong>
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left border-b text-muted-foreground">
                    <th className="py-2 pr-3 w-10">#</th>
                    <th className="py-2 pr-3">Judul</th>
                    <th className="py-2 pr-3 hidden md:table-cell">Penulis</th>
                    <th className="py-2 pr-3 hidden lg:table-cell">Klasifikasi</th>
                    <th className="py-2 pr-3 text-right">Pinjam</th>
                  </tr>
                </thead>
                <tbody>
                  {data.books.map((b, i) => (
                    <tr key={b.biblio_id} className="border-b last:border-0 hover:bg-muted/30">
                      <td className="py-2 pr-3 font-medium text-muted-foreground">{i + 1}</td>
                      <td className="py-2 pr-3 font-medium">{b.title}</td>
                      <td className="py-2 pr-3 text-muted-foreground hidden md:table-cell">{b.author_names}</td>
                      <td className="py-2 pr-3 hidden lg:table-cell">
                        {b.classification && <Badge variant="outline">{b.classification}</Badge>}
                      </td>
                      <td className="py-2 pr-3 text-right font-semibold">{b.loan_count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
