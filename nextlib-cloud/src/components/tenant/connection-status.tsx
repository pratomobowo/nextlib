"use client"

import { AlertCircle, CheckCircle2, Clock } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert"
import { cn } from "@/lib/utils"

export type ConnectionStatusType = "pending" | "connected" | "disconnected"

export interface ConnectionStatusProps {
  status: ConnectionStatusType
  errorMessage?: string
}

const statusConfig: Record<
  ConnectionStatusType,
  { label: string; icon: typeof CheckCircle2; className: string }
> = {
  connected: {
    label: "Connected",
    icon: CheckCircle2,
    className:
      "bg-green-100 text-green-800 border-green-200 dark:bg-green-900/30 dark:text-green-300 dark:border-green-800",
  },
  disconnected: {
    label: "Disconnected",
    icon: AlertCircle,
    className:
      "bg-red-100 text-red-800 border-red-200 dark:bg-red-900/30 dark:text-red-300 dark:border-red-800",
  },
  pending: {
    label: "Pending",
    icon: Clock,
    className:
      "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-800",
  },
}

export function ConnectionStatus({ status, errorMessage }: ConnectionStatusProps) {
  const config = statusConfig[status]
  const Icon = config.icon

  return (
    <div className="flex flex-col gap-2">
      <Badge
        className={cn("border", config.className)}
        aria-label={`Connection status: ${config.label}`}
      >
        <Icon data-icon="inline-start" className="size-3" />
        {config.label}
      </Badge>

      {status === "disconnected" && errorMessage && (
        <Alert variant="destructive">
          <AlertCircle className="size-4" />
          <AlertTitle>Connection Error</AlertTitle>
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
      )}
    </div>
  )
}
