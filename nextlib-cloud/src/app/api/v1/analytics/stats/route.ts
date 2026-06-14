import { NextRequest, NextResponse } from "next/server"
import { z } from "zod/v4"
import { db } from "@/lib/db"
import { dailyStats, tenants } from "@/lib/db/schema"
import { eq, and, between, sql } from "drizzle-orm"
import { computePercentChange } from "@/lib/analytics"
import type { StatsApiResponse, StatsApiError } from "@/lib/analytics/types"

/**
 * Zod validation schema for Stats API query parameters.
 */
export const statsQuerySchema = z.object({
  tenant_id: z.string().uuid(),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  granularity: z.enum(["daily", "weekly", "monthly"]).default("daily"),
}).refine(
  (data) => new Date(data.start_date) <= new Date(data.end_date),
  { message: "start_date must be before or equal to end_date" }
)

/**
 * Helper to create a JSON error response.
 */
function errorResponse(status: number, code: string, message: string) {
  return NextResponse.json(
    { error: true, code, message } satisfies StatsApiError,
    { status }
  )
}

import { getSessionUser } from "@/lib/auth/session"

/**
 * GET /api/v1/analytics/stats
 *
 * Returns aggregated daily statistics for a tenant within a date range.
 * Supports daily, weekly, and monthly granularity.
 * Includes summary with percentage changes compared to the previous equivalent period.
 */
export async function GET(request: NextRequest) {
  const sessionContext = await getSessionUser()
  if (!sessionContext) {
    return errorResponse(401, "UNAUTHORIZED", "Unauthenticated")
  }

  const { user } = sessionContext
  const searchParams = request.nextUrl.searchParams

  // Extract query parameters
  const tenantId = searchParams.get("tenant_id")
  const startDate = searchParams.get("start_date")
  const endDate = searchParams.get("end_date")
  const granularity = searchParams.get("granularity") || undefined

  // Enforce tenant isolation for non-super_admins
  if (user.role !== "super_admin" && user.tenantId !== tenantId) {
    return errorResponse(403, "FORBIDDEN", "You do not have permission to access this tenant's stats")
  }

  // --- Validation with specific error codes ---

  // Check missing tenant_id
  if (!tenantId) {
    return errorResponse(400, "MISSING_TENANT_ID", "tenant_id parameter is required")
  }

  // Check invalid UUID format
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (!uuidRegex.test(tenantId)) {
    return errorResponse(400, "INVALID_TENANT_ID", "tenant_id must be a valid UUID")
  }

  // Check missing date range
  if (!startDate || !endDate) {
    return errorResponse(400, "MISSING_DATE_RANGE", "start_date and end_date are required")
  }

  // Check invalid date format
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/
  if (!dateRegex.test(startDate) || !dateRegex.test(endDate)) {
    return errorResponse(400, "INVALID_DATE_FORMAT", "Dates must be in YYYY-MM-DD format")
  }

  // Check invalid granularity
  if (granularity && !["daily", "weekly", "monthly"].includes(granularity)) {
    return errorResponse(400, "INVALID_GRANULARITY", "granularity must be one of: daily, weekly, monthly")
  }

  // Validate with Zod schema (catches date range inversion)
  const parseResult = statsQuerySchema.safeParse({
    tenant_id: tenantId,
    start_date: startDate,
    end_date: endDate,
    granularity: granularity || "daily",
  })

  if (!parseResult.success) {
    // If it's a refinement error (start > end), return specific error
    return errorResponse(400, "INVALID_DATE_RANGE", "start_date must be before or equal to end_date")
  }

  const params = parseResult.data

  try {
    // --- Check tenant exists ---
    const tenantResult = await db
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.id, params.tenant_id))
      .limit(1)

    if (tenantResult.length === 0) {
      return errorResponse(404, "TENANT_NOT_FOUND", "No tenant found with the given ID")
    }

    // --- Fetch aggregated data based on granularity ---
    const data = await fetchAggregatedData(
      params.tenant_id,
      params.start_date,
      params.end_date,
      params.granularity
    )

    // --- Compute summary totals for current period ---
    const currentTotals = computeTotals(
      params.tenant_id,
      params.start_date,
      params.end_date
    )

    // --- Compute comparison period ---
    const startMs = new Date(params.start_date).getTime()
    const endMs = new Date(params.end_date).getTime()
    const rangeLengthDays = Math.round((endMs - startMs) / (1000 * 60 * 60 * 24)) + 1

    const compStartDate = new Date(startMs)
    compStartDate.setDate(compStartDate.getDate() - rangeLengthDays)
    const compEndDate = new Date(startMs)
    compEndDate.setDate(compEndDate.getDate() - 1)

    const compStartStr = compStartDate.toISOString().slice(0, 10)
    const compEndStr = compEndDate.toISOString().slice(0, 10)

    const previousTotals = computeTotals(
      params.tenant_id,
      compStartStr,
      compEndStr
    )

    // Await both totals
    const [current, previous] = await Promise.all([currentTotals, previousTotals])

    // --- Build response ---
    const response: StatsApiResponse = {
      data: data.map((row) => ({
        date: row.date,
        visitorCount: row.visitorCount,
        loanCount: row.loanCount,
        returnCount: row.returnCount,
      })),
      summary: {
        visitors: {
          total: current.visitors,
          percentChange: computePercentChange(current.visitors, previous.visitors),
        },
        loans: {
          total: current.loans,
          percentChange: computePercentChange(current.loans, previous.loans),
        },
        returns: {
          total: current.returns,
          percentChange: computePercentChange(current.returns, previous.returns),
        },
      },
      meta: {
        startDate: params.start_date,
        endDate: params.end_date,
        granularity: params.granularity,
        tenantId: params.tenant_id,
      },
    }

    return NextResponse.json(response, { status: 200 })
  } catch (error) {
    console.error("Stats API error:", error)
    return errorResponse(500, "SERVER_ERROR", "Internal server error")
  }
}

/**
 * Fetch aggregated data from daily_stats based on granularity.
 */
async function fetchAggregatedData(
  tenantId: string,
  startDate: string,
  endDate: string,
  granularity: "daily" | "weekly" | "monthly"
): Promise<{ date: string; visitorCount: number; loanCount: number; returnCount: number }[]> {
  if (granularity === "daily") {
    const rows = await db
      .select({
        date: dailyStats.date,
        visitorCount: dailyStats.visitorCount,
        loanCount: dailyStats.loanCount,
        returnCount: dailyStats.returnCount,
      })
      .from(dailyStats)
      .where(
        and(
          eq(dailyStats.tenantId, tenantId),
          between(dailyStats.date, startDate, endDate)
        )
      )
      .orderBy(dailyStats.date)

    return rows.map((row) => ({
      date: row.date,
      visitorCount: row.visitorCount,
      loanCount: row.loanCount,
      returnCount: row.returnCount,
    }))
  }

  // Weekly or monthly aggregation using DATE_TRUNC
  const truncFn = granularity === "weekly" ? "week" : "month"

  const rows = await db.execute(sql`
    SELECT
      DATE_TRUNC(${sql.raw(`'${truncFn}'`)}, ${dailyStats.date}::timestamp)::date AS date,
      SUM(${dailyStats.visitorCount})::int AS visitor_count,
      SUM(${dailyStats.loanCount})::int AS loan_count,
      SUM(${dailyStats.returnCount})::int AS return_count
    FROM ${dailyStats}
    WHERE ${dailyStats.tenantId} = ${tenantId}
      AND ${dailyStats.date} BETWEEN ${startDate} AND ${endDate}
    GROUP BY DATE_TRUNC(${sql.raw(`'${truncFn}'`)}, ${dailyStats.date}::timestamp)
    ORDER BY date ASC
  `)

  return (rows.rows as Array<{ date: string; visitor_count: number; loan_count: number; return_count: number }>).map(
    (row) => ({
      date: typeof row.date === "string" ? row.date : new Date(row.date as string).toISOString().slice(0, 10),
      visitorCount: Number(row.visitor_count),
      loanCount: Number(row.loan_count),
      returnCount: Number(row.return_count),
    })
  )
}

/**
 * Compute total sums for a tenant within a date range.
 */
async function computeTotals(
  tenantId: string,
  startDate: string,
  endDate: string
): Promise<{ visitors: number; loans: number; returns: number }> {
  const result = await db
    .select({
      visitors: sql<number>`COALESCE(SUM(${dailyStats.visitorCount}), 0)::int`,
      loans: sql<number>`COALESCE(SUM(${dailyStats.loanCount}), 0)::int`,
      returns: sql<number>`COALESCE(SUM(${dailyStats.returnCount}), 0)::int`,
    })
    .from(dailyStats)
    .where(
      and(
        eq(dailyStats.tenantId, tenantId),
        between(dailyStats.date, startDate, endDate)
      )
    )

  return {
    visitors: Number(result[0]?.visitors ?? 0),
    loans: Number(result[0]?.loans ?? 0),
    returns: Number(result[0]?.returns ?? 0),
  }
}
