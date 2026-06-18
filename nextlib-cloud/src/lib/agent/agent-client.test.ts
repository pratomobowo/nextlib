import { describe, it, expect, vi, beforeEach } from "vitest";
import { pullAgentDailyAggregate } from "./agent-client";

// vi.mock factories are hoisted above imports, so any value they reference
// must be defined via vi.hoisted (also hoisted) — module-level `const`s are not.
const { mockDecrypt } = vi.hoisted(() => ({
  mockDecrypt: vi.fn(),
}));

vi.mock("@/lib/crypto", () => ({
  decrypt: mockDecrypt,
}));

const fakeTenant = {
  slimsBaseUrl: "https://slims.example.com/",
  apiSecretEncrypted: "encrypted-fake",
};

const fakeEncryptionKey = "test-key";

describe("pullAgentDailyAggregate", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("calls /api/v1/nextlib/daily-aggregate with HMAC headers", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        schema_version: "2.0",
        start_date: "2024-01-01",
        end_date: "2024-01-07",
        days: [],
      }),
    });
    vi.stubGlobal("fetch", mockFetch);
    mockDecrypt.mockImplementation((val: string) => {
      if (val === fakeTenant.slimsBaseUrl) return "https://slims.example.com";
      if (val === fakeTenant.apiSecretEncrypted) return "test-secret";
      return val;
    });

    await pullAgentDailyAggregate(fakeTenant, "2024-01-01", "2024-01-07", fakeEncryptionKey);

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("https://slims.example.com/api/v1/nextlib/daily-aggregate");
    expect(init.method).toBe("POST");
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(init.headers["X-NextLib-Token"]).toBeDefined();
    expect(init.headers["X-NextLib-Secret-Hash"]).toBeDefined();
    expect(JSON.parse(init.body)).toEqual({
      start_date: "2024-01-01",
      end_date: "2024-01-07",
    });
  });

  it("returns parsed JSON on success", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        schema_version: "2.0",
        start_date: "2024-01-01",
        end_date: "2024-01-01",
        days: [
          {
            date: "2024-01-01",
            daily_metrics: {
              visitor_count: 5,
              unique_visitor_count: 3,
              loan_count: 2,
              return_count: 1,
              new_member_count: 0,
              new_biblio_count: 0,
              new_item_count: 0,
              fines_debet_total: 0,
              fines_credit_total: 0,
              reservation_count: 0,
            },
            snapshot_metrics: {
              total_collection_size: 100,
              active_member_count: 50,
              active_overdue_count: 2,
            },
            anomaly_flags: [],
          },
        ],
      }),
    });
    vi.stubGlobal("fetch", mockFetch);
    mockDecrypt.mockReturnValue("https://slims.example.com");

    const result = await pullAgentDailyAggregate(fakeTenant, "2024-01-01", "2024-01-01", fakeEncryptionKey);
    expect(result.success).toBe(true);
    expect(result.days).toHaveLength(1);
    expect(result.days?.[0]?.date).toBe("2024-01-01");
  });

  it("returns failure on 503", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({ code: "DB_CONNECTION_FAILED", message: "DB down" }),
    });
    vi.stubGlobal("fetch", mockFetch);
    mockDecrypt.mockReturnValue("https://slims.example.com");

    const result = await pullAgentDailyAggregate(fakeTenant, "2024-01-01", "2024-01-01", fakeEncryptionKey);
    expect(result.success).toBe(false);
    expect(result.status).toBe(503);
    expect(result.error).toContain("DB down");
  });
});