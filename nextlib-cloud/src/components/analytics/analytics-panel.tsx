"use client"

import * as React from "react"
import { useSearchParams, useRouter } from "next/navigation"
import { Users, BookOpen, BookCheck } from "lucide-react"

import { getPresetRange } from "@/lib/analytics"
import type { Granularity, StatsApiResponse } from "@/lib/analytics/types"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { DateRangePicker } from "./date-range-picker"
import { GranularityToggle } from "./granularity-toggle"
import { SummaryCard } from "./summary-card"
import { AnalyticsChart } from "./analytics-chart"
import { TenantSelector } from "./tenant-selector"

export interface AnalyticsPanelProps {
  tenants?: { id: string; name: string }[]
}

function formatDateParam(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

function parseDateParam(value: string | null, fallback: Date): Date {
  if (!value) return fallback
  const parsed = new Date(value + "T00:00:00")
  if (isNaN(parsed.getTime())) return fallback
  return parsed
}

export function AnalyticsPanel({ tenants }: AnalyticsPanelProps) {
  const searchParams = useSearchParams()
  const router = useRouter()

  // Compute default range: "30 Hari"
  const defaultRange = getPresetRange("30 Hari", new Date())

  // Read filter state from URL search params
  const startDate = parseDateParam(
    searchParams.get("start"),
    defaultRange.startDate
  )
  const endDate = parseDateParam(
    searchParams.get("end"),
    defaultRange.endDate
  )
  const granularity: Granularity =
    (searchParams.get("granularity") as Granularity) || "daily"
  const tenantId = searchParams.get("tenant_id") || (tenants?.[0]?.id ?? "")

  // Data fetching state
  const [data, setData] = React.useState<StatsApiResponse | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  // Determine if monthly should be disabled (range <= 7 days)
  const rangeDays = Math.round(
    (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)
  ) + 1
  const disableMonthly = rangeDays <= 7

  // Helper to update URL search params
  function updateParams(updates: Record<string, string>) {
    const params = new URLSearchParams(searchParams.toString())
    for (const [key, value] of Object.entries(updates)) {
      if (value) {
        params.set(key, value)
      } else {
        params.delete(key)
      }
    }
    router.push(`?${params.toString()}`, { scroll: false })
  }

  // Handlers
  function handleRangeChange(start: Date, end: Date) {
    updateParams({
      start: formatDateParam(start),
      end: formatDateParam(end),
    })
  }

  function handleGranularityChange(g: Granularity) {
    updateParams({ granularity: g })
  }

  function handleTenantChange(id: string) {
    updateParams({ tenant_id: id })
  }

  // Fetch data when filter state changes
  React.useEffect(() => {
    if (!tenantId) {
      setIsLoading(false)
      setData(null)
      return
    }

    const controller = new AbortController()
    setIsLoading(true)
    setError(null)

    const params = new URLSearchParams({
      tenant_id: tenantId,
      start_date: formatDateParam(startDate),
      end_date: formatDateParam(endDate),
      granularity,
    })

    fetch(`/api/v1/analytics/stats?${params.toString()}`, {
      signal: controller.signal,
    })
      .then((res) => {
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`)
        }
        return res.json()
      })
      .then((json: StatsApiResponse) => {
        setData(json)
        setIsLoading(false)
      })
      .catch((err) => {
        if (err.name === "AbortError") return
        setError("Terjadi kesalahan saat memuat data")
        setIsLoading(false)
      })

    return () => controller.abort()
  }, [tenantId, startDate.getTime(), endDate.getTime(), granularity])

  // Retry handler
  function handleRetry() {
    setError(null)
    setIsLoading(true)

    const params = new URLSearchParams({
      tenant_id: tenantId,
      start_date: formatDateParam(startDate),
      end_date: formatDateParam(endDate),
      granularity,
    })

    fetch(`/api/v1/analytics/stats?${params.toString()}`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json()
      })
      .then((json: StatsApiResponse) => {
        setData(json)
        setIsLoading(false)
      })
      .catch(() => {
        setError("Terjadi kesalahan saat memuat data")
        setIsLoading(false)
      })
  }

  return (
    <div className="space-y-6">
      {/* Filter controls */}
      <div className="flex flex-wrap items-center gap-4">
        {tenants && tenants.length > 0 && (
          <TenantSelector
            tenants={tenants}
            selectedId={tenantId}
            onChange={handleTenantChange}
          />
        )}
        <DateRangePicker
          startDate={startDate}
          endDate={endDate}
          onRangeChange={handleRangeChange}
        />
        <GranularityToggle
          value={granularity}
          onChange={handleGranularityChange}
          disableMonthly={disableMonthly}
        />
      </div>

      {/* Error state */}
      {error && (
        <div className="flex items-center gap-4 rounded-lg border border-destructive/50 bg-destructive/10 p-4">
          <p className="flex-1 text-sm text-destructive">{error}</p>
          <Button variant="outline" size="sm" onClick={handleRetry}>
            Coba Lagi
          </Button>
        </div>
      )}

      {/* Summary cards */}
      {!error && (
        <div className="grid gap-4 md:grid-cols-3">
          {isLoading ? (
            <>
              <SummaryCardSkeleton />
              <SummaryCardSkeleton />
              <SummaryCardSkeleton />
            </>
          ) : (
            <>
              <SummaryCard
                title="Total Pengunjung"
                value={data?.summary.visitors.total ?? 0}
                percentChange={data?.summary.visitors.percentChange ?? 0}
                icon={<Users className="size-4" />}
              />
              <SummaryCard
                title="Total Peminjaman"
                value={data?.summary.loans.total ?? 0}
                percentChange={data?.summary.loans.percentChange ?? 0}
                icon={<BookOpen className="size-4" />}
              />
              <SummaryCard
                title="Total Pengembalian"
                value={data?.summary.returns.total ?? 0}
                percentChange={data?.summary.returns.percentChange ?? 0}
                icon={<BookCheck className="size-4" />}
              />
            </>
          )}
        </div>
      )}

      {/* Chart */}
      {!error && (
        <AnalyticsChart data={data?.data ?? []} isLoading={isLoading} />
      )}
    </div>
  )
}

function SummaryCardSkeleton() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-4 w-24" />
      </CardHeader>
      <CardContent>
        <Skeleton className="mb-2 h-8 w-20" />
        <Skeleton className="h-3 w-16" />
      </CardContent>
    </Card>
  )
}
