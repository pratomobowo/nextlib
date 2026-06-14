"use client"

import { ArrowUp, ArrowDown } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"

export interface SummaryCardProps {
  title: string
  value: number
  percentChange: number
  icon: React.ReactNode
}

function formatValue(value: number): string {
  return value.toLocaleString("id-ID")
}

function getChangeDirection(percentChange: number): "up" | "down" | "neutral" {
  if (percentChange > 0) return "up"
  if (percentChange < 0) return "down"
  return "neutral"
}

function buildAriaLabel(title: string, value: number, percentChange: number): string {
  const direction = getChangeDirection(percentChange)
  const directionText =
    direction === "up"
      ? "naik"
      : direction === "down"
        ? "turun"
        : "tidak berubah"
  return `${title}: ${formatValue(value)}, ${Math.abs(percentChange).toFixed(1)}% ${directionText}`
}

export function SummaryCard({ title, value, percentChange, icon }: SummaryCardProps) {
  const direction = getChangeDirection(percentChange)

  return (
    <Card
      aria-label={buildAriaLabel(title, value, percentChange)}
    >
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium text-muted-foreground">
            {title}
          </CardTitle>
          <span className="text-muted-foreground">{icon}</span>
        </div>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{formatValue(value)}</div>
        <PercentageBadge percentChange={percentChange} direction={direction} />
      </CardContent>
    </Card>
  )
}

function PercentageBadge({
  percentChange,
  direction,
}: {
  percentChange: number
  direction: "up" | "down" | "neutral"
}) {
  return (
    <span
      className={cn(
        "mt-1 inline-flex items-center gap-0.5 text-xs font-medium",
        direction === "up" && "text-green-600 dark:text-green-400",
        direction === "down" && "text-red-600 dark:text-red-400",
        direction === "neutral" && "text-muted-foreground"
      )}
    >
      {direction === "up" && <ArrowUp className="size-3" />}
      {direction === "down" && <ArrowDown className="size-3" />}
      {direction === "neutral" ? "0%" : `${Math.abs(percentChange).toFixed(1)}%`}
    </span>
  )
}
