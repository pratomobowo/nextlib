"use client"

import * as React from "react"
import { format } from "date-fns"
import { CalendarIcon } from "lucide-react"

import { getPresetRange, type DateRangePreset } from "@/lib/analytics"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"

const PRESETS: DateRangePreset[] = ["7 Hari", "30 Hari", "Bulan Ini", "Tahun Ini"]

interface DateRangePickerProps {
  startDate: Date
  endDate: Date
  onRangeChange: (start: Date, end: Date) => void
}

export function DateRangePicker({
  startDate,
  endDate,
  onRangeChange,
}: DateRangePickerProps) {
  const [activePreset, setActivePreset] = React.useState<
    DateRangePreset | "Custom"
  >("30 Hari")
  const [customOpen, setCustomOpen] = React.useState(false)
  const [selectingField, setSelectingField] = React.useState<"start" | "end">(
    "start"
  )

  const today = new Date()

  function handlePresetClick(preset: DateRangePreset) {
    setActivePreset(preset)
    setCustomOpen(false)
    const { startDate: start, endDate: end } = getPresetRange(preset, new Date())
    onRangeChange(start, end)
  }

  function handleCalendarSelect(date: Date | undefined) {
    if (!date) return

    if (selectingField === "start") {
      // If selected start date is after current end, adjust end to same date
      const newEnd = date > endDate ? date : endDate
      onRangeChange(date, newEnd)
      setSelectingField("end")
    } else {
      // Ensure end >= start
      const newEnd = date < startDate ? startDate : date
      onRangeChange(startDate, newEnd)
      setCustomOpen(false)
      setSelectingField("start")
    }
  }

  return (
    <div
      className="flex flex-wrap items-center gap-2"
      role="group"
      aria-label="Pilih rentang tanggal"
    >
      {PRESETS.map((preset) => (
        <Button
          key={preset}
          variant={activePreset === preset ? "default" : "outline"}
          size="sm"
          onClick={() => handlePresetClick(preset)}
          aria-pressed={activePreset === preset}
        >
          {preset}
        </Button>
      ))}

      <Popover
        open={customOpen}
        onOpenChange={(open) => {
          setCustomOpen(open)
          if (open) {
            setActivePreset("Custom")
            setSelectingField("start")
          }
        }}
      >
        <PopoverTrigger
          render={
            <Button
              variant={activePreset === "Custom" ? "default" : "outline"}
              size="sm"
              aria-pressed={activePreset === "Custom"}
            />
          }
        >
          <CalendarIcon className="mr-1 size-4" />
          {activePreset === "Custom"
            ? `${format(startDate, "dd/MM/yyyy")} – ${format(endDate, "dd/MM/yyyy")}`
            : "Custom"}
        </PopoverTrigger>
        <PopoverContent align="start" className="w-auto p-0">
          <div className="p-3">
            <p className="mb-2 text-sm font-medium text-muted-foreground">
              {selectingField === "start"
                ? "Pilih tanggal mulai"
                : "Pilih tanggal akhir"}
            </p>
            <Calendar
              mode="single"
              selected={selectingField === "start" ? startDate : endDate}
              onSelect={handleCalendarSelect}
              disabled={(date) => {
                // Disable future dates beyond today
                if (date > today) return true
                // When selecting end date, disable dates before start
                if (selectingField === "end" && date < startDate) return true
                return false
              }}
              defaultMonth={selectingField === "start" ? startDate : endDate}
            />
            <div className="mt-2 flex items-center justify-between border-t pt-2 text-xs text-muted-foreground">
              <span>
                Mulai:{" "}
                <span className="font-medium text-foreground">
                  {format(startDate, "dd/MM/yyyy")}
                </span>
              </span>
              <span>
                Akhir:{" "}
                <span className="font-medium text-foreground">
                  {format(endDate, "dd/MM/yyyy")}
                </span>
              </span>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}
