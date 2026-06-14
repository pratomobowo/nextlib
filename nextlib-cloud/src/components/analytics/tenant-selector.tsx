"use client"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

export interface TenantSelectorProps {
  tenants: { id: string; name: string }[]
  selectedId: string
  onChange: (tenantId: string) => void
}

export function TenantSelector({
  tenants,
  selectedId,
  onChange,
}: TenantSelectorProps) {
  const items = tenants.map((t) => ({ value: t.id, label: t.name }))

  return (
    <Select
      value={selectedId}
      onValueChange={(value) => {
        if (value !== null) {
          onChange(value as string)
        }
      }}
      items={items}
    >
      <SelectTrigger aria-label="Pilih tenant">
        <SelectValue placeholder="Pilih tenant" />
      </SelectTrigger>
      <SelectContent>
        {tenants.map((tenant) => (
          <SelectItem key={tenant.id} value={tenant.id}>
            {tenant.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
