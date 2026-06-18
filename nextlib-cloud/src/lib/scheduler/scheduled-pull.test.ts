import { describe, it, expect, vi, beforeEach } from "vitest";
import { runScheduledPull } from "./scheduled-pull";

// vi.mock factories are hoisted above imports, so any value they reference
// must be defined via vi.hoisted (also hoisted) — module-level `const`s are not.
const { dbMock, pullAgentDailyAggregateMock, bulkUpsertDailyStatsV2Mock, updateTenantPullStatusMock } = vi.hoisted(() => ({
  dbMock: {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn(),
  },
  pullAgentDailyAggregateMock: vi.fn(),
  bulkUpsertDailyStatsV2Mock: vi.fn(),
  updateTenantPullStatusMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ db: dbMock }));
vi.mock("@/lib/agent/agent-client", () => ({
  pullAgentDailyAggregate: pullAgentDailyAggregateMock,
}));
vi.mock("@/lib/analytics/daily-stats-bulk", () => ({
  bulkUpsertDailyStatsV2: bulkUpsertDailyStatsV2Mock,
  updateTenantPullStatus: updateTenantPullStatusMock,
}));

const fakeTenantA = {
  id: "tenant-a",
  slimsBaseUrl: "enc-a",
  apiSecretEncrypted: "enc-a-secret",
};
const fakeTenantB = {
  id: "tenant-b",
  slimsBaseUrl: "enc-b",
  apiSecretEncrypted: "enc-b-secret",
};

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

describe("runScheduledPull", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    process.env.AES_256_ENCRYPTION_KEY = "a".repeat(64);
    dbMock.select.mockReturnThis();
    dbMock.from.mockReturnThis();
    pullAgentDailyAggregateMock.mockResolvedValue({ success: true, status: 200, days: [] });
    bulkUpsertDailyStatsV2Mock.mockResolvedValue({ rowsAffected: 0 });
    updateTenantPullStatusMock.mockResolvedValue(undefined);
  });

  it("processes all connected tenants and calls pullAgentDailyAggregate for each with today-6 to today", async () => {
    dbMock.where.mockResolvedValueOnce([fakeTenantA, fakeTenantB]);

    await runScheduledPull();

    expect(pullAgentDailyAggregateMock).toHaveBeenCalledTimes(2);

    const today = new Date();
    const expectedEnd = isoDate(today);
    const expectedStartDate = new Date(today);
    expectedStartDate.setUTCDate(expectedStartDate.getUTCDate() - 6);
    const expectedStart = isoDate(expectedStartDate);

    for (const call of pullAgentDailyAggregateMock.mock.calls) {
      const [tenantArg, startArg, endArg, keyArg] = call as [
        typeof fakeTenantA,
        string,
        string,
        string,
      ];
      expect([fakeTenantA.id, fakeTenantB.id]).toContain(tenantArg.id);
      expect(startArg).toBe(expectedStart);
      expect(endArg).toBe(expectedEnd);
      expect(keyArg).toBe("a".repeat(64));
    }

    expect(bulkUpsertDailyStatsV2Mock).toHaveBeenCalledTimes(2);
    expect(updateTenantPullStatusMock).toHaveBeenCalledTimes(2);
    for (const call of updateTenantPullStatusMock.mock.calls) {
      expect(call[1]).toBe("ok");
    }
  });

  it("isolates failures: if pullAgentDailyAggregate throws, updateTenantPullStatus('failed') is called and the next tenant still processes", async () => {
    dbMock.where.mockResolvedValueOnce([fakeTenantA, fakeTenantB]);

    const boom = new Error("network unreachable");
    pullAgentDailyAggregateMock
      .mockRejectedValueOnce(boom)
      .mockResolvedValueOnce({ success: true, status: 200, days: [] });

    await runScheduledPull();

    expect(pullAgentDailyAggregateMock).toHaveBeenCalledTimes(2);

    const failedCall = updateTenantPullStatusMock.mock.calls.find(
      (c) => (c[0] as string) === "tenant-a"
    );
    expect(failedCall).toBeDefined();
    expect(failedCall?.[1]).toBe("failed");
    expect(failedCall?.[2]).toBe("network unreachable");

    const okCall = updateTenantPullStatusMock.mock.calls.find(
      (c) => (c[0] as string) === "tenant-b"
    );
    expect(okCall).toBeDefined();
    expect(okCall?.[1]).toBe("ok");
  });
});