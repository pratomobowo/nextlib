import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  bulkUpsertDailyStatsV2,
  updateTenantPullStatus,
} from "./daily-stats-bulk";

// vi.mock factories are hoisted above imports, so any value they reference
// must be defined via vi.hoisted (also hoisted) — module-level `const`s are not.
const { dbMock, onConflictMock } = vi.hoisted(() => {
  const onConflictMock = vi.fn().mockReturnThis();
  const dbMock = {
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    where: vi.fn(),
    onConflictDoUpdate: onConflictMock,
  };
  return { dbMock, onConflictMock };
});

vi.mock("@/lib/db", () => ({ db: dbMock }));

describe("bulkUpsertDailyStatsV2", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMock.insert.mockReturnThis();
    dbMock.values.mockReturnThis();
    dbMock.update.mockReturnThis();
    dbMock.set.mockReturnThis();
    dbMock.onConflictDoUpdate.mockReturnThis();
  });

  it("inserts and updates on conflict for 1 day", async () => {
    const day = {
      date: "2025-01-01",
      visitorCount: 10,
      uniqueVisitorCount: 5,
      loanCount: 3,
      returnCount: 2,
      newMemberCount: 1,
      newBiblioCount: 0,
      newItemCount: 0,
      finesDebetTotal: 0,
      finesCreditTotal: 0,
      reservationCount: 0,
      totalCollectionSize: 100,
      activeMemberCount: 20,
      activeOverdueCount: 1,
      anomalyFlags: [],
    };
    const result = await bulkUpsertDailyStatsV2("tenant-1", [day]);
    expect(dbMock.insert).toHaveBeenCalledOnce();
    expect(dbMock.onConflictDoUpdate).toHaveBeenCalledOnce();
    expect(result).toEqual({ rowsAffected: 1 });
  });

  it("returns rowsAffected=0 and skips db.insert for empty input", async () => {
    const result = await bulkUpsertDailyStatsV2("tenant-1", []);
    expect(result).toEqual({ rowsAffected: 0 });
    expect(dbMock.insert).not.toHaveBeenCalled();
  });
});

describe("updateTenantPullStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMock.update.mockReturnThis();
    dbMock.set.mockReturnThis();
    dbMock.where.mockResolvedValue(undefined);
  });

  it("updates lastPullAt, lastPullStatus (no error)", async () => {
    await updateTenantPullStatus("tenant-1", "ok");
    expect(dbMock.update).toHaveBeenCalledOnce();
    expect(dbMock.set).toHaveBeenCalledOnce();
    const setArg = dbMock.set.mock.calls[0][0] as Record<string, unknown>;
    expect(setArg.lastPullStatus).toBe("ok");
    expect(setArg.lastPullError).toBeNull();
    expect(setArg.lastPullAt).toBeInstanceOf(Date);
  });

  it("truncates error message to 500 chars", async () => {
    const longError = "x".repeat(1000);
    await updateTenantPullStatus("tenant-1", "failed", longError);
    const setArg = dbMock.set.mock.calls[0][0] as Record<string, unknown>;
    expect(typeof setArg.lastPullError).toBe("string");
    expect((setArg.lastPullError as string).length).toBe(500);
  });
});