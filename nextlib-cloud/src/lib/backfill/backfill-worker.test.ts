import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";

describe("backfill-worker chunking", () => {
  it("uses pull-based architecture (no triggerAgentExport)", () => {
    const contents = readFileSync("src/lib/backfill/backfill-worker.ts", "utf-8");
    expect(contents).toContain("CHUNK_DAYS = 90");
    expect(contents).toContain("pullAgentDailyAggregate");
    expect(contents).toContain("bulkUpsertDailyStatsV2");
    expect(contents).not.toContain("triggerAgentExport");
  });
});
