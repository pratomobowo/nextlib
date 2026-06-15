"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Download, Activity, Users, Clock } from "lucide-react"
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
  BarChart, Bar, PieChart, Pie, Cell,
} from "recharts"
import { downloadAnalyticsCsv } from "@/lib/analytics/export"

interface Trend { ym: string; loans: number; unique_members: number }
interface MemberType { type_name: string; count: number }
interface AgeBucket { bucket: string; count: number }
interface PeakHour { hour: number; visits: number }

interface ActivityData {
  trends: Trend[]
  demographics: {
    member_types: MemberType[]
    gender: { male: number; female: number; unknown: number }
    age_buckets: AgeBucket[]
  }
  activity: {
    active: number
    dormant: number
    total: number
    new_in_period: number
    months: number
    active_pct: number
  }
  peak_hours: PeakHour[]
}

const PIE_COLORS = ["#3b82f6", "#ec4899", "#9ca3af"]

export function ActivityPanel() {
  const [data, setData] = useState<ActivityData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [months, setMonths] = useState(12)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true); setError(null)
      try {
        const res = await fetch(`/api/v1/analytics/activity?months=${months}`, { cache: "no-store" })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const json = (await res.json()) as ActivityData
        if (!cancelled) setData(json)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Gagal memuat data")
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [months])

  if (error) return <p className="text-sm text-destructive">{error}</p>
  if (loading || !data) return <Skeleton className="h-96 w-full" />

  const a = data.activity
  const genderData = [
    { name: "Laki-laki", value: data.demographics.gender.male },
    { name: "Perempuan", value: data.demographics.gender.female },
  ].filter((d) => d.value > 0)

  return (
    <div className="space-y-4">
      {/* Activity summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <SummaryCard label="Member Aktif" value={a.active} sub={`${a.active_pct}% dari total`} icon={<Activity className="h-4 w-4" />} />
        <SummaryCard label="Member Dormant" value={a.dormant} sub={`>${months} bulan tak aktif`} />
        <SummaryCard label="Total Member" value={a.total} />
        <SummaryCard label="Member Baru" value={a.new_in_period} sub={`${months} bulan terakhir`} />
      </div>

      {/* Loan trend line chart */}
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Tren Peminjaman Bulanan</CardTitle>
          <div className="flex items-center gap-2">
            <select
              value={months}
              onChange={(e) => setMonths(Number(e.target.value))}
              className="h-8 rounded-md border border-input bg-background px-2 text-xs"
            >
              <option value={6}>6 bulan</option>
              <option value={12}>12 bulan</option>
              <option value={24}>24 bulan</option>
              <option value={60}>5 tahun</option>
            </select>
            <Button variant="outline" size="sm" onClick={() => downloadAnalyticsCsv("activity", { months })}>
              <Download className="h-3.5 w-3.5 mr-1" /> CSV
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div style={{ height: 280 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data.trends} margin={{ left: 0, right: 20 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="ym" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend formatter={(v) => (v === "loans" ? "Peminjaman" : "Member Unik")} />
                <Line type="monotone" dataKey="loans" stroke="#3b82f6" strokeWidth={2} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="unique_members" stroke="#10b981" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Gender pie */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Users className="h-4 w-4" /> Demografi Gender
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div style={{ height: 220 }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={genderData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={75}
                    label={(entry: { name?: string; value?: number }) =>
                      `${entry.name ?? ""}: ${entry.value ?? 0}`
                    }>
                    {genderData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Member types bar */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Tipe Member</CardTitle>
          </CardHeader>
          <CardContent>
            <div style={{ height: 220 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.demographics.member_types} layout="vertical" margin={{ left: 30 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="type_name" tick={{ fontSize: 11 }} width={80} />
                  <Tooltip />
                  <Bar dataKey="count" fill="#8b5cf6" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Peak hours */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Clock className="h-4 w-4" /> Jam Sibuk Kunjungan
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div style={{ height: 240 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.peak_hours.map((p) => ({ ...p, label: `${p.hour}:00` }))}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip formatter={(value) => [Number(value).toLocaleString("id-ID"), "Kunjungan"]} />
                <Bar dataKey="visits" fill="#f59e0b" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function SummaryCard({ label, value, sub, icon }: { label: string; value: number; sub?: string; icon?: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">{label}</p>
          {icon}
        </div>
        <p className="text-2xl font-bold">{value.toLocaleString("id-ID")}</p>
        {sub && <p className="text-[10px] text-muted-foreground">{sub}</p>}
      </CardContent>
    </Card>
  )
}
