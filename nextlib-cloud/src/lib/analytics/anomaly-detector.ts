/**
 * Cloud-side anomaly detection for daily library metrics.
 *
 * This replaces the previous agent-side AnomalyTagger (PHP). Moving it
 * cloud-side eliminates ~900 SLiMS queries per daily export (the agent used
 * to recompute 30-day baselines by re-querying SLiMS for each historical
 * day). On the cloud, baselines come from the indexed `daily_stats_v2`
 * table — a single SQL query, orders of magnitude faster, and it keeps the
 * load off the campus SLiMS database entirely.
 *
 * The 4 rules below are a faithful TypeScript port of the PHP
 * `NextLibAgent\Exporter\AnomalyTagger::detectAnomalies()`. Thresholds,
 * ordering, and weekday handling are preserved for reproducibility.
 *
 * One intentional deviation from the PHP version: a minimum-baseline guard.
 * The PHP code fired `visitor_spike` / `loan_spike` / `overdue_spike`
 * whenever `count > 0` and baseline was 0 (e.g. on a brand-new tenant's
 * first day with any activity), producing false positives. Here we skip a
 * spike rule when its baseline is 0, so a tenant only gets flagged once it
 * has a meaningful historical average to compare against.
 */

import { and, eq, gte, lt, sql, asc } from "drizzle-orm";
import { db } from "@/lib/db";
import { dailyStatsV2 } from "@/lib/db/schema";

/**
 * Number of days preceding the target date used to compute the baseline.
 * Matches the PHP `AnomalyTagger::computeBaseline()` window.
 */
export const BASELINE_WINDOW_DAYS = 30;

/**
 * The set of anomaly flag strings this module can emit, in evaluation order.
 * Keep this order stable — downstream consumers and tests rely on it.
 */
export const ANOMALY_FLAGS = [
  "visitor_spike",
  "zero_visitors_weekday",
  "loan_spike",
  "overdue_spike",
] as const;

export type AnomalyFlag = (typeof ANOMALY_FLAGS)[number];

/**
 * Inputs from the current day's metrics, used by the rules.
 */
export interface CurrentMetrics {
  visitorCount: number;
  loanCount: number;
  /** Point-in-time count of loans past their due date and not yet returned. */
  activeOverdueCount: number;
}

/**
 * Result of a baseline lookup: the arithmetic mean of each metric over the
 * `BASELINE_WINDOW_DAYS` days immediately preceding the target date.
 */
interface Baselines {
  visitor: number;
  loan: number;
  overdue: number;
}

/**
 * Compute the anomaly flags for a single (tenant, date) row.
 *
 * Side effects: one indexed SELECT against `daily_stats_v2`. Safe to call
 * from a request handler or a worker.
 *
 * @param tenantId   Tenant UUID
 * @param targetDate ISO date string `YYYY-MM-DD`
 * @param current    The current day's metric values
 * @returns Ordered array of flag strings (subset of ANOMALY_FLAGS)
 */
export async function computeAnomalyFlags(
  tenantId: string,
  targetDate: string,
  current: CurrentMetrics
): Promise<string[]> {
  const baselines = await loadBaselines(tenantId, targetDate);
  return applyRules(current, baselines, targetDate);
}

/**
 * Pure rule application — exported for unit testing without a database.
 * Replicates `AnomalyTagger::detectAnomalies()` rule-for-rule.
 */
export function applyRules(
  current: CurrentMetrics,
  baselines: Baselines,
  targetDate: string
): string[] {
  const flags: string[] = [];

  // Rule 1: visitor spike — current visitor count more than doubles the
  // 30-day baseline. Skip when baseline is 0 (no history yet) to avoid
  // false positives for new tenants.
  if (baselines.visitor > 0 && current.visitorCount > 2 * baselines.visitor) {
    flags.push("visitor_spike");
  }

  // Rule 2: zero visitors on a weekday. Weekends are expected to be empty
  // and are not flagged. Matches PHP `isWeekday` (Mon–Fri).
  if (current.visitorCount === 0 && isWeekday(targetDate)) {
    flags.push("zero_visitors_weekday");
  }

  // Rule 3: loan spike — same pattern as visitor spike.
  if (baselines.loan > 0 && current.loanCount > 2 * baselines.loan) {
    flags.push("loan_spike");
  }

  // Rule 4: overdue spike — uses a stricter 3× multiplier because overdue
  // counts are noisier (a single late batch return can swing the number).
  if (
    baselines.overdue > 0 &&
    current.activeOverdueCount > 3 * baselines.overdue
  ) {
    flags.push("overdue_spike");
  }

  return flags;
}

/**
 * Load the 30-day baseline averages for visitor, loan, and overdue counts.
 *
 * The window is the `BASELINE_WINDOW_DAYS` days strictly before `targetDate`
 * (targetDate itself is excluded, matching the PHP implementation).
 *
 * Missing historical rows (e.g. gaps from an incomplete backfill) are simply
 * not counted — the average is taken over whatever rows exist. With zero
 * matching rows, every baseline defaults to 0, which suppresses the spike
 * rules via the minimum-baseline guard.
 */
async function loadBaselines(
  tenantId: string,
  targetDate: string
): Promise<Baselines> {
  const windowStart = new Date(targetDate);
  windowStart.setUTCDate(windowStart.getUTCDate() - BASELINE_WINDOW_DAYS);
  // daily_stats_v2.date is a date-only string column (YYYY-MM-DD), so compare
  // against the date portion rather than a full Date object.
  const windowStartStr = windowStart.toISOString().slice(0, 10);

  // Single aggregated query over the indexed (tenant_id, date) range.
  // AVG returns NULL when no rows match; coalesce to 0.
  const rows = await db
    .select({
      avgVisitor: sql<number>`COALESCE(AVG(${dailyStatsV2.visitorCount}), 0)::float`,
      avgLoan: sql<number>`COALESCE(AVG(${dailyStatsV2.loanCount}), 0)::float`,
      avgOverdue: sql<number>`COALESCE(AVG(${dailyStatsV2.activeOverdueCount}), 0)::float`,
    })
    .from(dailyStatsV2)
    .where(
      and(
        eq(dailyStatsV2.tenantId, tenantId),
        gte(dailyStatsV2.date, windowStartStr),
        lt(dailyStatsV2.date, targetDate)
      )
    );

  const r = rows[0] ?? { avgVisitor: 0, avgLoan: 0, avgOverdue: 0 };
  return {
    visitor: Number(r.avgVisitor) || 0,
    loan: Number(r.avgLoan) || 0,
    overdue: Number(r.avgOverdue) || 0,
  };
}

/**
 * Whether a date falls on a weekday (Monday–Friday).
 * Uses the local interpretation of the target date. PHP `date('N')` returns
 * 1 for Monday … 7 for Sunday; JavaScript `getDay()` returns 0 for Sunday …
 * 6 for Saturday, so we map accordingly.
 */
export function isWeekday(dateStr: string): boolean {
  // Parse as a local date at midnight to avoid off-by-one from UTC shifts.
  const [y, m, d] = dateStr.split("-").map(Number);
  const day = new Date(y, m - 1, d).getDay();
  return day >= 1 && day <= 5; // 1=Mon ... 5=Fri
}

/**
 * Recompute and persist anomaly flags for a single (tenant, date) row.
 *
 * Reads the row's own metrics from `daily_stats_v2`, recomputes the baseline
 * from the surrounding 30 days, and writes the new flags back. Used by the
 * migration script and any future "refresh flags" job.
 *
 * @returns The recomputed flags, or null if the row does not exist.
 */
export async function recomputeFlagsForRow(
  tenantId: string,
  targetDate: string
): Promise<string[] | null> {
  const rows = await db
    .select({
      visitorCount: dailyStatsV2.visitorCount,
      loanCount: dailyStatsV2.loanCount,
      activeOverdueCount: dailyStatsV2.activeOverdueCount,
    })
    .from(dailyStatsV2)
    .where(and(eq(dailyStatsV2.tenantId, tenantId), eq(dailyStatsV2.date, targetDate)))
    .limit(1);

  if (rows.length === 0) return null;

  const row = rows[0];
  const flags = await computeAnomalyFlags(tenantId, targetDate, {
    visitorCount: row.visitorCount,
    loanCount: row.loanCount,
    activeOverdueCount: row.activeOverdueCount,
  });

  await db
    .update(dailyStatsV2)
    .set({ anomalyFlags: flags, receivedAt: new Date() })
    .where(
      and(
        eq(dailyStatsV2.tenantId, tenantId),
        eq(dailyStatsV2.date, targetDate)
      )
    );

  return flags;
}

/**
 * List all (tenantId, date) pairs in `daily_stats_v2`, oldest first.
 * Used by the migration script to iterate every row.
 */
export async function listAllDailyStatsV2Dates(): Promise<
  { tenantId: string; date: string }[]
> {
  const rows = await db
    .select({
      tenantId: dailyStatsV2.tenantId,
      date: dailyStatsV2.date,
    })
    .from(dailyStatsV2)
    .orderBy(asc(dailyStatsV2.tenantId), asc(dailyStatsV2.date));

  // daily_stats_v2.date is a date-only string column; values come back as
  // YYYY-MM-DD already, no normalisation needed.
  return rows.map((r) => ({
    tenantId: r.tenantId,
    date: r.date,
  }));
}

