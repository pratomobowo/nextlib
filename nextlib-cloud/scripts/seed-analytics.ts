/**
 * Seed script for analytics development/testing.
 *
 * Inserts 30 days of sample daily_stats data for the first tenant found
 * in the database (or a specific tenant by name).
 *
 * Usage:
 *   npx tsx scripts/seed-analytics.ts
 *   npx tsx scripts/seed-analytics.ts "Pustakalaya"
 */

import { db } from "../src/lib/db"
import { tenants, dailyStats } from "../src/lib/db/schema"
import { eq, sql } from "drizzle-orm"

async function main() {
  const targetName = process.argv[2] // Optional: tenant name from CLI arg

  // 1. Find tenant
  let tenant
  if (targetName) {
    const results = await db
      .select({ id: tenants.id, name: tenants.name })
      .from(tenants)
      .where(eq(tenants.name, targetName))
      .limit(1)
    tenant = results[0]
  } else {
    const results = await db
      .select({ id: tenants.id, name: tenants.name })
      .from(tenants)
      .limit(1)
    tenant = results[0]
  }

  if (!tenant) {
    console.error(`❌ Tenant not found${targetName ? `: "${targetName}"` : ""}`)
    console.log("Available tenants:")
    const all = await db.select({ id: tenants.id, name: tenants.name }).from(tenants)
    all.forEach((t) => console.log(`  - ${t.name} (${t.id})`))
    process.exit(1)
  }

  console.log(`✅ Found tenant: ${tenant.name} (${tenant.id})`)

  // 2. Generate 60 days of sample data (for comparison period to work)
  const today = new Date()
  const records = []

  for (let i = 59; i >= 0; i--) {
    const date = new Date(today)
    date.setDate(date.getDate() - i)
    const dateStr = date.toISOString().slice(0, 10)

    // Random but realistic numbers
    const visitorCount = Math.floor(Math.random() * 150) + 20 // 20-170
    const loanCount = Math.floor(Math.random() * 60) + 5 // 5-65
    const returnCount = Math.floor(Math.random() * 50) + 3 // 3-53

    records.push({
      tenantId: tenant.id,
      date: dateStr,
      visitorCount,
      loanCount,
      returnCount,
    })
  }

  // 3. Upsert (insert, skip if date already exists for this tenant)
  let inserted = 0
  let skipped = 0

  for (const record of records) {
    try {
      await db.insert(dailyStats).values(record)
      inserted++
    } catch (error: any) {
      if (error?.code === "23505") {
        // Duplicate — already has data for this tenant+date
        skipped++
      } else {
        throw error
      }
    }
  }

  console.log(`\n📊 Seed complete:`)
  console.log(`   Inserted: ${inserted} records`)
  console.log(`   Skipped (already exist): ${skipped} records`)
  console.log(`   Date range: ${records[0].date} → ${records[records.length - 1].date}`)
  console.log(`\n🎉 Open /dashboard/analytics to see the charts!`)

  process.exit(0)
}

main().catch((err) => {
  console.error("Fatal error:", err)
  process.exit(1)
})
