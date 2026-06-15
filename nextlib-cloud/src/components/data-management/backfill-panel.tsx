"use client"

import { useEffect, useState, useCallback, useRef } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Database, Play, Square, AlertCircle, CheckCircle2, Loader2, Clock } from "lucide-react"

interface BackfillJob {
  id: string
  status: "pending" | "running" | "completed" | "failed" | "cancelled"
  dateStart: string
  dateEnd: string
  totalDays: number
  processedDays: number
  failedDays: number
  percent: number
  lastProcessedDate: string | null
  lastError: string | null
  startedAt: string | null
  completedAt: string | null
  createdAt: string | null
}

interface HistoryJob {
  id: string
  status: string
  dateStart: string
  dateEnd: string
  totalDays: number
  processedDays: number
  failedDays: number
  lastError: string | null
  createdAt: string | null
  completedAt: string | null
}

/** Default to one year back from today. */
function defaultStart(): string {
  const d = new Date()
  d.setFullYear(d.getFullYear() - 1)
  return d.toISOString().slice(0, 10)
}
function defaultEnd(): string {
  return new Date().toISOString().slice(0, 10)
}

export function BackfillPanel() {
  const [dateStart, setDateStart] = useState(defaultStart())
  const [dateEnd, setDateEnd] = useState(defaultEnd())
  const [job, setJob] = useState<BackfillJob | null>(null)
  const [history, setHistory] = useState<HistoryJob[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const isActive = job !== null && ["pending", "running"].includes(job.status)

  /** Poll status while a job is active. */
  const refreshStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/backfill/status", { cache: "no-store" })
      if (!res.ok) return
      const data = (await res.json()) as { job: BackfillJob | null }
      setJob(data.job)
    } catch {
      // network blip — keep last known state
    }
  }, [])

  const refreshHistory = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/backfill/jobs", { cache: "no-store" })
      if (!res.ok) return
      const data = (await res.json()) as { jobs: HistoryJob[] }
      setHistory(data.jobs)
    } catch {
      // ignore
    }
  }, [])

  // Initial load + polling while active
  useEffect(() => {
    void refreshStatus()
    void refreshHistory()
  }, [refreshStatus, refreshHistory])

  useEffect(() => {
    if (isActive) {
      pollRef.current = setInterval(() => {
        void refreshStatus()
      }, 3000)
    }
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
    }
  }, [isActive, refreshStatus])

  // Refresh history once a job transitions to terminal
  useEffect(() => {
    if (job && !isActive) {
      void refreshHistory()
    }
  }, [job, isActive, refreshHistory])

  async function handleStart() {
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch("/api/v1/backfill/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date_start: dateStart, date_end: dateEnd }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.message || "Gagal memulai sinkronisasi")
        return
      }
      await refreshStatus()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error")
    } finally {
      setSubmitting(false)
    }
  }

  async function handleCancel() {
    try {
      await fetch("/api/v1/backfill/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      })
      await refreshStatus()
    } catch {
      // ignore
    }
  }

  const startBeforeEnd = dateStart <= dateEnd

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Database className="h-4 w-4" />
            Sinkronisasi Data Historis
          </CardTitle>
          <CardDescription>
            Tarik data statistik harian (pengunjung, peminjaman, pengembalian) dari SLiMS
            lokal ke NextLib-Cloud. Proses berjalan di background — Anda bisa menutup tab ini.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="date-start">Dari Tanggal</Label>
              <Input
                id="date-start"
                type="date"
                value={dateStart}
                onChange={(e) => setDateStart(e.target.value)}
                disabled={isActive || submitting}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="date-end">Sampai Tanggal</Label>
              <Input
                id="date-end"
                type="date"
                value={dateEnd}
                onChange={(e) => setDateEnd(e.target.value)}
                disabled={isActive || submitting}
              />
            </div>
          </div>

          {!startBeforeEnd && (
            <p className="text-sm text-destructive flex items-center gap-1">
              <AlertCircle className="h-4 w-4" />
              Tanggal mulai harus sebelum atau sama dengan tanggal akhir.
            </p>
          )}

          {error && (
            <p className="text-sm text-destructive flex items-center gap-1">
              <AlertCircle className="h-4 w-4" />
              {error}
            </p>
          )}

          <div className="flex gap-2">
            <Button
              onClick={handleStart}
              disabled={isActive || submitting || !startBeforeEnd}
            >
              {submitting ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1" />
              ) : (
                <Play className="h-4 w-4 mr-1" />
              )}
              Mulai Sinkronisasi
            </Button>
            {isActive && (
              <Button variant="outline" onClick={handleCancel}>
                <Square className="h-4 w-4 mr-1" />
                Batalkan
              </Button>
            )}
          </div>

          {job && <JobProgress job={job} />}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Riwayat Sinkronisasi</CardTitle>
        </CardHeader>
        <CardContent>
          {history.length === 0 ? (
            <p className="text-sm text-muted-foreground">Belum ada riwayat sinkronisasi.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left border-b">
                    <th className="py-2 pr-4">Periode</th>
                    <th className="py-2 pr-4">Status</th>
                    <th className="py-2 pr-4">Hari</th>
                    <th className="py-2 pr-4">Gagal</th>
                    <th className="py-2 pr-4">Dibuat</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((h) => (
                    <tr key={h.id} className="border-b last:border-0">
                      <td className="py-2 pr-4 font-mono text-xs">
                        {h.dateStart} → {h.dateEnd}
                      </td>
                      <td className="py-2 pr-4">
                        <StatusBadge status={h.status} />
                      </td>
                      <td className="py-2 pr-4">
                        {h.processedDays}/{h.totalDays}
                      </td>
                      <td className="py-2 pr-4">{h.failedDays}</td>
                      <td className="py-2 pr-4 text-muted-foreground text-xs">
                        {h.createdAt ? new Date(h.createdAt).toLocaleString("id-ID") : "-"}
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

function JobProgress({ job }: { job: BackfillJob }) {
  return (
    <div className="space-y-2 rounded-md border p-4 bg-muted/30">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <StatusBadge status={job.status} />
          <span className="text-sm text-muted-foreground font-mono">
            {job.dateStart} → {job.dateEnd}
          </span>
        </div>
        <span className="text-sm font-medium">{job.percent}%</span>
      </div>

      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full bg-primary transition-all duration-500"
          style={{ width: `${job.percent}%` }}
        />
      </div>

      <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
        <span>
          Proses: <strong className="text-foreground">{job.processedDays}</strong>/{job.totalDays} hari
        </span>
        {job.failedDays > 0 && (
          <span className="text-destructive">
            Gagal: <strong>{job.failedDays}</strong>
          </span>
        )}
        {job.lastProcessedDate && (
          <span>
            Terakhir: <strong className="text-foreground font-mono">{job.lastProcessedDate}</strong>
          </span>
        )}
      </div>

      {job.lastError && (
        <p className="text-xs text-destructive flex items-start gap-1 pt-1">
          <AlertCircle className="h-3 w-3 mt-0.5 shrink-0" />
          {job.lastError}
        </p>
      )}
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline"; icon: typeof Clock }> = {
    pending: { label: "Menunggu", variant: "secondary", icon: Clock },
    running: { label: "Berjalan", variant: "default", icon: Loader2 },
    completed: { label: "Selesai", variant: "default", icon: CheckCircle2 },
    failed: { label: "Gagal", variant: "destructive", icon: AlertCircle },
    cancelled: { label: "Dibatalkan", variant: "outline", icon: Square },
  }
  const conf = map[status] ?? { label: status, variant: "outline" as const, icon: AlertCircle }
  const Icon = conf.icon
  const spin = status === "running" || status === "pending"
  return (
    <Badge variant={conf.variant} className="gap-1">
      <Icon className={`h-3 w-3 ${spin ? "animate-spin" : ""}`} />
      {conf.label}
    </Badge>
  )
}
