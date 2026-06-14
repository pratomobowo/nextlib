/**
 * Direct SLiMS → NextLib-Cloud sync script.
 *
 * Queries the SLiMS MySQL database directly and inserts aggregate stats
 * into the nextlib-cloud PostgreSQL daily_stats table.
 *
 * This bypasses the agent/HMAC flow — useful for local development.
 *
 * Usage:
 *   npx tsx scripts/sync-from-slims.ts
 *   npx tsx scripts/sync-from-slims.ts 30    # sync last 30 days (default)
 *   npx tsx scripts/sync-from-slims.ts 365   # sync last year
 */

import mysql from "mysql2/promise"
import { db } from "../src/lib/db"
import { tenants, dailyStats } from "../src/lib/db/schema"
import { eq } from "drizzle-orm"

// Tenant is resolved by slug (env-driven) rather than a hardcoded UUID.
const TENANT_SLUG = process.env.SYNC_TENANT_SLUG || "universitas-nextlib"
const DAYS_BACK = parseInt(process.argv[2] || "60", 10)

// SLiMS MySQL config — read from env so this dev script stays secret-free.
const SLIMS_DB = {
  host: process.env.SLIMS_DB_HOST || "localhost",
  port: parseInt(process.env.SLIMS_DB_PORT || "3306", 10),
  database: process.env.SLIMS_DB_NAME || "slims",
  user: process.env.SLIMS_DB_USER || "root",
  password: process.env.SLIMS_DB_PASS || "",
}

async function main() {
  console.log(`🔗 Connecting to SLiMS MySQL (${SLIMS_DB.database})...`)
  const mysqlConn = await mysql.createConnection(SLIMS_DB)

  // Resolve tenant by slug (env-driven) so the script is secret-free.
  const [tenant] = await db
    .select({ id: tenants.id, name: tenants.name })
    .from(tenants)
    .where(eq(tenants.slug, TENANT_SLUG))
    .limit(1)

  if (!tenant) {
    console.error(`❌ Tenant slug "${TENANT_SLUG}" not found in cloud database`)
    process.exit(1)
  }
  console.log(`✅ Target tenant: ${tenant.name} (${tenant.id})`)

  // Generate date range
  const today = new Date()
  const dates: string[] = []
  for (let i = DAYS_BACK - 1; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(d.getDate() - i)
    dates.push(d.toISOString().slice(0, 10))
  }

  console.log(`📅 Syncing ${dates.length} days: ${dates[0]} → ${dates[dates.length - 1]}`)
  console.log("")

  let inserted = 0
  let skipped = 0

  for (const date of dates) {
    // Query visitors from SLiMS
    const [visitorRows] = await mysqlConn.execute(
      "SELECT COUNT(*) as cnt FROM visitor_count WHERE DATE(checkin_date) = ?",
      [date]
    )
    const visitorCount = (visitorRows as any[])[0]?.cnt ?? 0

    // Query loans from SLiMS
    const [loanRows] = await mysqlConn.execute(
      "SELECT COUNT(*) as cnt FROM loan WHERE DATE(loan_date) = ?",
      [date]
    )
    const loanCount = (loanRows as any[])[0]?.cnt ?? 0

    // Query returns from SLiMS
    const [returnRows] = await mysqlConn.execute(
      "SELECT COUNT(*) as cnt FROM loan WHERE DATE(return_date) = ?",
      [date]
    )
    const returnCount = (returnRows as any[])[0]?.cnt ?? 0

    // Insert into cloud PostgreSQL (skip if already exists)
    try {
      await db.insert(dailyStats).values({
        tenantId: tenant.id,
        date,
        visitorCount,
        loanCount,
        returnCount,
      })
      inserted++
      if (visitorCount > 0 || loanCount > 0 || returnCount > 0) {
        console.log(`  ✅ ${date}: visitors=${visitorCount}, loans=${loanCount}, returns=${returnCount}`)
      }
    } catch (error: any) {
      if (error?.code === "23505") {
        skipped++ // duplicate
      } else {
        throw error
      }
    }
  }

  await mysqlConn.end()

  console.log(`\n📊 Sync complete:`)
  console.log(`   Inserted: ${inserted} records`)
  console.log(`   Skipped (already exist): ${skipped} records`)
  console.log(`\n🎉 Open /dashboard/analytics to see real SLiMS data!`)

  process.exit(0)
}

main().catch((err) => {
  console.error("Fatal error:", err)
  process.exit(1)
})
