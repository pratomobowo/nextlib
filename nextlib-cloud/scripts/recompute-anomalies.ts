/**
 * Migration / maintenance script: recompute anomaly_flags for every row in
 * daily_stats_v2 using the cloud-side anomaly detector.
 *
 * Run this once after deploying the cloud-side anomaly computation
 * (Part A of the anomaly-refactor plan) to populate flags on rows that were
 * imported before the cloud computed them. After that, the v2/aggregate
 * route computes flags at ingestion time, so this script is only needed
 * again if the rules change or to backfill a large historical import.
 *
 * Usage:
 *   npx tsx scripts/recompute-anomalies.ts                  # all tenants
 *   npx tsx scripts/recompute-anomalies.ts <tenantId>       # one tenant
 *   npx tsx scripts/recompute-anomalies.ts <tenantId> 2026  # one tenant, one year
 */

import { db } from "../src/lib/db"
import { tenants } from "../src/lib/db/schema"
import { eq } from "drizzle-orm"
import {
  listAllDailyStatsV2Dates,
  recomputeFlagsForRow,
} from "../src/lib/analytics/anomaly-detector"

async function main() {
  const tenantArg = process.argv[2]
  const yearArg = process.argv[3]

  // Optional tenant filter
  let tenantFilter: string | null = null
  if (tenantArg) {
    const rows = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.id, tenantArg)).limit(1)
    if (rows.length === 0) {
      console.error(`Tenant not found: ${tenantArg}`)
      process.exit(1)
    }
    tenantFilter = rows[0].id
  }

  console.log("Loading daily_stats_v2 rows…")
  let allDates = await listAllDailyStatsV2Dates()
  if (tenantFilter) {
    allDates = allDates.filter((r) => r.tenantId === tenantFilter)
  }
  if (yearArg) {
    allDates = allDates.filter((r) => r.date.startsWith(yearArg))
  }

  console.log(`Recomputing flags for ${allDates.length} row(s)…`)
  let updated = 0
  let skipped = 0
  let flagged = 0
  const start = Date.now()

  for (const { tenantId, date } of allDates) {
    const flags = await recomputeFlagsForRow(tenantId, date)
    if (flags === null) {
      skipped++
    } else {
      updated++
      if (flags.length > 0) flagged++
    }
    if ((updated + skipped) % 100 === 0) {
      console.log(
        `  progress ${updated + skipped}/${allDates.length} ` +
          `(updated=${updated} flagged=${flagged} skipped=${skipped})`
      )
    }
  }

  const secs = ((Date.now() - start) / 1000).toFixed(1)
  console.log(
    `Done in ${secs}s — updated=${updated} flagged=${flagged} skipped=${skipped}`
  )
  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
