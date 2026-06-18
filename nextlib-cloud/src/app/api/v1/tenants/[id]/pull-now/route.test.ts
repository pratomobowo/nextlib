import { describe, it, expect, vi, beforeEach } from "vitest";

const sessionUser = { user: { id: "u1", email: "a@x", role: "tenant_admin", tenantId: "t1" } };

const {
  getSessionUserMock,
  pullAgentDailyAggregateMock,
  bulkUpsertDailyStatsV2Mock,
  updateTenantPullStatusMock,
  decryptMock,
  dbSelectMock,
} = vi.hoisted(() => ({
  getSessionUserMock: vi.fn(),
  pullAgentDailyAggregateMock: vi.fn(),
  bulkUpsertDailyStatsV2Mock: vi.fn(),
  updateTenantPullStatusMock: vi.fn(),
  decryptMock: vi.fn(),
  dbSelectMock: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({ getSessionUser: () => getSessionUserMock() }));
vi.mock("@/lib/tenant-access-guard", () => ({
  checkTenantAccess: (user: { role: string; tenantId: string | null }, tenantId: string) => {
    if (!user) return { allowed: false, status: 401, code: "UNAUTHORIZED", message: "Authentication required" };
    if (user.role === "super_admin") return { allowed: true };
    if (user.tenantId === tenantId) return { allowed: true };
    return { allowed: false, status: 403, code: "FORBIDDEN", message: "You do not have access to this tenant." };
  },
}));
vi.mock("@/lib/agent/agent-client", () => ({
  pullAgentDailyAggregate: (...a: unknown[]) => pullAgentDailyAggregateMock(...a),
}));
vi.mock("@/lib/analytics/daily-stats-bulk", () => ({
  bulkUpsertDailyStatsV2: (...a: unknown[]) => bulkUpsertDailyStatsV2Mock(...a),
  updateTenantPullStatus: (...a: unknown[]) => updateTenantPullStatusMock(...a),
}));
vi.mock("@/lib/crypto", () => ({
  decrypt: (...a: unknown[]) => decryptMock(...a),
}));
vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({ from: () => ({ where: () => ({ limit: () => dbSelectMock() }) }) }),
  },
}));
vi.mock("@/lib/db/schema", () => ({
  tenants: { id: "id" },
  backfillJobs: { id: "id", tenantId: "tenantId" },
}));
vi.mock("@/lib/backfill/backfill-queue", () => ({
  backfillQueue: { add: vi.fn().mockResolvedValue({ id: "job1" }) },
}));

import { POST } from "./route";

beforeEach(() => {
  getSessionUserMock.mockReset();
  pullAgentDailyAggregateMock.mockReset();
  bulkUpsertDailyStatsV2Mock.mockReset();
  updateTenantPullStatusMock.mockReset();
  decryptMock.mockReset();
  dbSelectMock.mockReset();

  process.env.AES_256_ENCRYPTION_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  getSessionUserMock.mockResolvedValue(sessionUser);
  decryptMock.mockImplementation((v: string) => v);
  pullAgentDailyAggregateMock.mockResolvedValue({
    success: true,
    status: 200,
    days: [
      {
        date: "2024-01-01",
        daily_metrics: {
          visitor_count: 1, unique_visitor_count: 1, loan_count: 1, return_count: 0,
          new_member_count: 0, new_biblio_count: 0, new_item_count: 0,
          fines_debet_total: 0, fines_credit_total: 0, reservation_count: 0,
        },
        snapshot_metrics: { total_collection_size: 100, active_member_count: 10, active_overdue_count: 1 },
        anomaly_flags: [],
      },
    ],
  });
  bulkUpsertDailyStatsV2Mock.mockResolvedValue({ rowsAffected: 1 });
  updateTenantPullStatusMock.mockResolvedValue(undefined);
  dbSelectMock.mockResolvedValue([{ slimsBaseUrl: "https://slims.example.com", apiSecretEncrypted: "encrypted" }]);
});

function makeReq(body: unknown) {
  return new Request("http://test/api/v1/tenants/t1/pull-now", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /pull-now", () => {
  it("returns 401 when no session", async () => {
    getSessionUserMock.mockResolvedValue(null);
    const res = await POST(makeReq({ start_date: "2024-01-01", end_date: "2024-01-07" }), {
      params: Promise.resolve({ id: "t1" }),
    });
    expect(res.status).toBe(401);
  });

  it("returns 200 with days_imported on successful immediate pull", async () => {
    const res = await POST(makeReq({ start_date: "2024-01-01", end_date: "2024-01-07" }), {
      params: Promise.resolve({ id: "t1" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.days_imported).toBe(1);
    expect(body.rows_affected).toBe(1);
    expect(body.start_date).toBe("2024-01-01");
    expect(body.end_date).toBe("2024-01-07");
  });

  it("returns 400 on invalid date range (>366 days)", async () => {
    const res = await POST(makeReq({ start_date: "2020-01-01", end_date: "2024-01-01" }), {
      params: Promise.resolve({ id: "t1" }),
    });
    expect(res.status).toBe(400);
  });
});
