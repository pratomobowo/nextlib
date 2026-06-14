"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { MessageCircle, ArrowUpRight, ArrowDownLeft, Clock, Zap } from "lucide-react"

interface MessageStatsData {
  incoming: number
  outgoing: number
  avgResponseMs: number
  intentBreakdown: {
    faq: number
    circulation: number
    greeting: number
    unknown: number
  }
}

interface MessageStatsProps {
  tenantId: string
}

export function MessageStats({ tenantId }: MessageStatsProps) {
  const [stats, setStats] = useState<MessageStatsData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchStats() {
      try {
        const res = await fetch(`/api/v1/whatsapp/stats?tenantId=${tenantId}`)
        if (res.ok) {
          const data = await res.json()
          if (data.success) {
            setStats(data.data)
          }
        }
      } catch (error) {
        console.error("Failed to fetch message stats:", error)
      } finally {
        setLoading(false)
      }
    }

    fetchStats()
    // Refresh every 30 seconds
    const interval = setInterval(fetchStats, 30000)
    return () => clearInterval(interval)
  }, [tenantId])

  if (loading) {
    return (
      <div className="grid gap-4 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i} className="animate-pulse">
            <CardHeader className="pb-2">
              <div className="h-4 w-20 bg-muted rounded" />
            </CardHeader>
            <CardContent>
              <div className="h-8 w-16 bg-muted rounded" />
            </CardContent>
          </Card>
        ))}
      </div>
    )
  }

  const data = stats || {
    incoming: 0,
    outgoing: 0,
    avgResponseMs: 0,
    intentBreakdown: { faq: 0, circulation: 0, greeting: 0, unknown: 0 },
  }

  const totalMessages = data.incoming + data.outgoing
  const avgResponseSec = data.avgResponseMs > 0 ? (data.avgResponseMs / 1000).toFixed(1) : "0"

  // Calculate intent percentages
  const intentTotal = Object.values(data.intentBreakdown).reduce((a, b) => a + b, 0)
  const intentPercentages = {
    faq: intentTotal > 0 ? Math.round((data.intentBreakdown.faq / intentTotal) * 100) : 0,
    circulation: intentTotal > 0 ? Math.round((data.intentBreakdown.circulation / intentTotal) * 100) : 0,
    greeting: intentTotal > 0 ? Math.round((data.intentBreakdown.greeting / intentTotal) * 100) : 0,
    unknown: intentTotal > 0 ? Math.round((data.intentBreakdown.unknown / intentTotal) * 100) : 0,
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-4">
        {/* Total Messages */}
        <Card className="relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-blue-500/10 to-purple-500/10" />
          <CardHeader className="relative pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <MessageCircle className="h-4 w-4" />
              Total Pesan Hari Ini
            </CardTitle>
          </CardHeader>
          <CardContent className="relative">
            <div className="text-3xl font-bold">{totalMessages}</div>
          </CardContent>
        </Card>

        {/* Incoming */}
        <Card className="relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-green-500/10 to-emerald-500/10" />
          <CardHeader className="relative pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <ArrowDownLeft className="h-4 w-4 text-green-500" />
              Masuk
            </CardTitle>
          </CardHeader>
          <CardContent className="relative">
            <div className="text-3xl font-bold text-green-600">{data.incoming}</div>
          </CardContent>
        </Card>

        {/* Outgoing */}
        <Card className="relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-orange-500/10 to-amber-500/10" />
          <CardHeader className="relative pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <ArrowUpRight className="h-4 w-4 text-orange-500" />
              Keluar
            </CardTitle>
          </CardHeader>
          <CardContent className="relative">
            <div className="text-3xl font-bold text-orange-600">{data.outgoing}</div>
          </CardContent>
        </Card>

        {/* Avg Response Time */}
        <Card className="relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-violet-500/10 to-fuchsia-500/10" />
          <CardHeader className="relative pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Clock className="h-4 w-4 text-violet-500" />
              Rata-rata Respons
            </CardTitle>
          </CardHeader>
          <CardContent className="relative">
            <div className="text-3xl font-bold text-violet-600">{avgResponseSec}s</div>
          </CardContent>
        </Card>
      </div>

      {/* Intent Breakdown */}
      {intentTotal > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Zap className="h-4 w-4" />
              Distribusi Intent
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <IntentBar label="FAQ" count={data.intentBreakdown.faq} percentage={intentPercentages.faq} color="bg-blue-500" />
              <IntentBar label="Sirkulasi" count={data.intentBreakdown.circulation} percentage={intentPercentages.circulation} color="bg-emerald-500" />
              <IntentBar label="Salam" count={data.intentBreakdown.greeting} percentage={intentPercentages.greeting} color="bg-amber-500" />
              <IntentBar label="Lainnya" count={data.intentBreakdown.unknown} percentage={intentPercentages.unknown} color="bg-gray-400" />
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function IntentBar({
  label,
  count,
  percentage,
  color,
}: {
  label: string
  count: number
  percentage: number
  color: string
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-16 text-sm text-muted-foreground">{label}</span>
      <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${color}`}
          style={{ width: `${percentage}%` }}
        />
      </div>
      <span className="w-12 text-sm text-right font-medium">{count}</span>
      <span className="w-10 text-xs text-muted-foreground text-right">{percentage}%</span>
    </div>
  )
}
