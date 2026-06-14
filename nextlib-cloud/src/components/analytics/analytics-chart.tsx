"use client"

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { ChartDataPoint } from "@/lib/analytics/types"

export interface AnalyticsChartProps {
  data: ChartDataPoint[]
  isLoading: boolean
}

export function AnalyticsChart({ data, isLoading }: AnalyticsChartProps) {
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Tren Aktivitas
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div
            className="h-[300px] animate-pulse rounded bg-muted"
            role="status"
            aria-label="Memuat grafik"
          />
        </CardContent>
      </Card>
    )
  }

  if (data.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-muted-foreground">
            Tren Aktivitas
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex h-[300px] items-center justify-center text-muted-foreground">
            Belum ada data untuk periode ini
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium text-muted-foreground">
          Tren Aktivitas
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={300} minHeight={300}>
          <AreaChart data={data}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis
              dataKey="date"
              className="text-xs text-muted-foreground"
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              className="text-xs text-muted-foreground"
              tickLine={false}
              axisLine={false}
            />
            <Tooltip content={<ChartTooltip />} />
            <Area
              type="monotone"
              dataKey="visitorCount"
              name="Pengunjung"
              stroke="#3b82f6"
              fill="#3b82f6"
              fillOpacity={0.1}
              strokeWidth={2}
            />
            <Area
              type="monotone"
              dataKey="loanCount"
              name="Peminjaman"
              stroke="#22c55e"
              fill="#22c55e"
              fillOpacity={0.1}
              strokeWidth={2}
            />
            <Area
              type="monotone"
              dataKey="returnCount"
              name="Pengembalian"
              stroke="#f59e0b"
              fill="#f59e0b"
              fillOpacity={0.1}
              strokeWidth={2}
            />
          </AreaChart>
        </ResponsiveContainer>

        {/* Hidden accessible data table for screen readers */}
        <AccessibleDataTable data={data} />
      </CardContent>
    </Card>
  )
}

function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null

  return (
    <div className="rounded-md border bg-background p-3 shadow-sm">
      <p className="mb-1 text-sm font-medium">{label}</p>
      {payload.map((entry: any) => (
        <p key={entry.name} className="text-xs text-muted-foreground">
          {entry.name}: {entry.value?.toLocaleString("id-ID")}
        </p>
      ))}
    </div>
  )
}

function AccessibleDataTable({ data }: { data: ChartDataPoint[] }) {
  return (
    <table
      className="sr-only"
      aria-label="Data tren aktivitas perpustakaan"
      role="table"
    >
      <thead>
        <tr>
          <th scope="col">Tanggal</th>
          <th scope="col">Pengunjung</th>
          <th scope="col">Peminjaman</th>
          <th scope="col">Pengembalian</th>
        </tr>
      </thead>
      <tbody>
        {data.map((point) => (
          <tr key={point.date}>
            <td>{point.date}</td>
            <td>{point.visitorCount}</td>
            <td>{point.loanCount}</td>
            <td>{point.returnCount}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
