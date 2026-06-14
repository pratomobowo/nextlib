"use client"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import type { Granularity } from "@/lib/analytics/types"

export interface GranularityToggleProps {
  value: Granularity
  onChange: (g: Granularity) => void
  disableMonthly?: boolean
}

const OPTIONS: { label: string; granularity: Granularity }[] = [
  { label: "Harian", granularity: "daily" },
  { label: "Mingguan", granularity: "weekly" },
  { label: "Bulanan", granularity: "monthly" },
]

export function GranularityToggle({
  value,
  onChange,
  disableMonthly = false,
}: GranularityToggleProps) {
  return (
    <div
      className="inline-flex items-center gap-1 rounded-lg border border-border p-1"
      role="group"
      aria-label="Granularitas data"
    >
      {OPTIONS.map(({ label, granularity }) => {
        const isActive = value === granularity
        const isDisabled = granularity === "monthly" && disableMonthly

        return (
          <Button
            key={granularity}
            variant={isActive ? "default" : "ghost"}
            size="sm"
            aria-pressed={isActive}
            disabled={isDisabled}
            onClick={() => onChange(granularity)}
            className={cn(
              "min-w-[5rem]",
              isActive && "pointer-events-none"
            )}
          >
            {label}
          </Button>
        )
      })}
    </div>
  )
}
