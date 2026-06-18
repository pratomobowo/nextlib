import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { dailyStatsV2, tenants } from "@/lib/db/schema";

/**
 * Input row for bulkUpsertDailyStatsV2.
 * Mirrors the metric columns on daily_stats_v2 (sans tenantId, id, receivedAt).
 */
export interface DailyStatsV2Input {
  date: string;
  visitorCount: number;
  uniqueVisitorCount: number;
  loanCount: number;
  returnCount: number;
  newMemberCount: number;
  newBiblioCount: number;
  newItemCount: number;
  finesDebetTotal: number;
  finesCreditTotal: number;
  reservationCount: number;
  totalCollectionSize: number;
  activeMemberCount: number;
  activeOverdueCount: number;
  anomalyFlags: string[];
}

export interface BulkUpsertResult {
  rowsAffected: number;
}

/**
 * Idempotent bulk upsert into daily_stats_v2.
 * Conflict target: (tenant_id, date). On conflict, all 14 metric columns are
 * overwritten from EXCLUDED.* and received_at is bumped to NOW().
 *
 * Safe to re-run for the same date range.
 */
export async function bulkUpsertDailyStatsV2(
  tenantId: string,
  days: DailyStatsV2Input[]
): Promise<BulkUpsertResult> {
  if (days.length === 0) {
    return { rowsAffected: 0 };
  }

  const values = days.map((d) => ({
    tenantId,
    date: d.date,
    visitorCount: d.visitorCount,
    uniqueVisitorCount: d.uniqueVisitorCount,
    loanCount: d.loanCount,
    returnCount: d.returnCount,
    newMemberCount: d.newMemberCount,
    newBiblioCount: d.newBiblioCount,
    newItemCount: d.newItemCount,
    finesDebetTotal: d.finesDebetTotal,
    finesCreditTotal: d.finesCreditTotal,
    reservationCount: d.reservationCount,
    totalCollectionSize: d.totalCollectionSize,
    activeMemberCount: d.activeMemberCount,
    activeOverdueCount: d.activeOverdueCount,
    anomalyFlags: d.anomalyFlags,
  }));

  await db
    .insert(dailyStatsV2)
    .values(values)
    .onConflictDoUpdate({
      target: [dailyStatsV2.tenantId, dailyStatsV2.date],
      set: {
        visitorCount: sql`EXCLUDED.visitor_count`,
        uniqueVisitorCount: sql`EXCLUDED.unique_visitor_count`,
        loanCount: sql`EXCLUDED.loan_count`,
        returnCount: sql`EXCLUDED.return_count`,
        newMemberCount: sql`EXCLUDED.new_member_count`,
        newBiblioCount: sql`EXCLUDED.new_biblio_count`,
        newItemCount: sql`EXCLUDED.new_item_count`,
        finesDebetTotal: sql`EXCLUDED.fines_debet_total`,
        finesCreditTotal: sql`EXCLUDED.fines_credit_total`,
        reservationCount: sql`EXCLUDED.reservation_count`,
        totalCollectionSize: sql`EXCLUDED.total_collection_size`,
        activeMemberCount: sql`EXCLUDED.active_member_count`,
        activeOverdueCount: sql`EXCLUDED.active_overdue_count`,
        anomalyFlags: sql`EXCLUDED.anomaly_flags`,
        receivedAt: sql`NOW()`,
      },
    });

  return { rowsAffected: days.length };
}

const MAX_PULL_ERROR_LENGTH = 500;

/**
 * Records the result of the most recent SaaS-side pull-sync attempt.
 * - status: 'ok' | 'failed' | 'partial'
 * - errorMessage: optional, truncated to 500 chars
 */
export async function updateTenantPullStatus(
  tenantId: string,
  status: "ok" | "failed" | "partial",
  errorMessage?: string
): Promise<void> {
  const truncated =
    typeof errorMessage === "string"
      ? errorMessage.slice(0, MAX_PULL_ERROR_LENGTH)
      : null;

  await db
    .update(tenants)
    .set({
      lastPullAt: new Date(),
      lastPullStatus: status,
      lastPullError: truncated,
    })
    .where(sql`${tenants.id} = ${tenantId}`);
}