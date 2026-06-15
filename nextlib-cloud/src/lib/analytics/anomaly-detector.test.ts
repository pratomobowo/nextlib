import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  ANOMALY_FLAGS,
  applyRules,
  isWeekday,
  type CurrentMetrics,
} from "./anomaly-detector";

describe("anomaly-detector — applyRules", () => {
  // A neutral baseline used by most rule-specific tests.
  const baselines = { visitor: 100, loan: 50, overdue: 10 };

  it("returns no flags when all metrics are within baseline", () => {
    const current: CurrentMetrics = {
      visitorCount: 150, // < 2×100
      loanCount: 80, // < 2×50
      activeOverdueCount: 25, // < 3×10
    };
    // 2026-06-15 is a Monday (weekday), but visitor > 0 so no zero flag.
    expect(applyRules(current, baselines, "2026-06-15")).toEqual([]);
  });

  // --- Rule 1: visitor_spike -------------------------------------------
  it("flags visitor_spike when visitorCount > 2× baseline", () => {
    const current: CurrentMetrics = {
      visitorCount: 250, // > 2×100 = 200
      loanCount: 0,
      activeOverdueCount: 0,
    };
    // Sunday so zero_visitors_weekday does not also fire.
    expect(applyRules(current, baselines, "2026-06-14")).toEqual([
      "visitor_spike",
    ]);
  });

  it("does not flag visitor_spike at exactly 2× (strict >)", () => {
    const current: CurrentMetrics = {
      visitorCount: 200, // === 2×100, not strictly greater
      loanCount: 0,
      activeOverdueCount: 0,
    };
    expect(applyRules(current, baselines, "2026-06-14")).toEqual([]);
  });

  it("does not flag visitor_spike when baseline is 0 (minimum-baseline guard)", () => {
    const current: CurrentMetrics = {
      visitorCount: 5,
      loanCount: 0,
      activeOverdueCount: 0,
    };
    expect(applyRules(current, { ...baselines, visitor: 0 }, "2026-06-14")).toEqual(
      []
    );
  });

  // --- Rule 2: zero_visitors_weekday -----------------------------------
  it("flags zero_visitors_weekday on a Monday with 0 visitors", () => {
    const current: CurrentMetrics = {
      visitorCount: 0,
      loanCount: 0,
      activeOverdueCount: 0,
    };
    expect(applyRules(current, baselines, "2026-06-15")).toEqual([
      "zero_visitors_weekday",
    ]);
  });

  it("does not flag zero_visitors_weekday on a weekend with 0 visitors", () => {
    const current: CurrentMetrics = {
      visitorCount: 0,
      loanCount: 0,
      activeOverdueCount: 0,
    };
    // 2026-06-14 is Sunday, 2026-06-13 is Saturday
    expect(applyRules(current, baselines, "2026-06-14")).toEqual([]);
    expect(applyRules(current, baselines, "2026-06-13")).toEqual([]);
  });

  it("does not flag zero_visitors_weekday when visitors > 0 on a weekday", () => {
    const current: CurrentMetrics = {
      visitorCount: 1,
      loanCount: 0,
      activeOverdueCount: 0,
    };
    expect(applyRules(current, baselines, "2026-06-15")).toEqual([]);
  });

  // --- Rule 3: loan_spike ----------------------------------------------
  it("flags loan_spike when loanCount > 2× baseline", () => {
    const current: CurrentMetrics = {
      visitorCount: 50,
      loanCount: 150, // > 2×50 = 100
      activeOverdueCount: 0,
    };
    expect(applyRules(current, baselines, "2026-06-14")).toEqual(["loan_spike"]);
  });

  it("does not flag loan_spike when baseline is 0 (guard)", () => {
    const current: CurrentMetrics = {
      visitorCount: 0,
      loanCount: 5,
      activeOverdueCount: 0,
    };
    expect(applyRules(current, { ...baselines, loan: 0 }, "2026-06-14")).toEqual(
      []
    );
  });

  // --- Rule 4: overdue_spike (3× multiplier) ---------------------------
  it("flags overdue_spike when activeOverdueCount > 3× baseline", () => {
    const current: CurrentMetrics = {
      visitorCount: 0,
      loanCount: 0,
      activeOverdueCount: 40, // > 3×10 = 30
    };
    expect(applyRules(current, baselines, "2026-06-14")).toEqual([
      "overdue_spike",
    ]);
  });

  it("does not flag overdue_spike at exactly 3× (strict >)", () => {
    const current: CurrentMetrics = {
      visitorCount: 0,
      loanCount: 0,
      activeOverdueCount: 30, // === 3×10
    };
    expect(applyRules(current, baselines, "2026-06-14")).toEqual([]);
  });

  // --- Ordering & combination ------------------------------------------
  it("emits flags in the canonical order when multiple fire", () => {
    const current: CurrentMetrics = {
      visitorCount: 500, // > 2×100 → visitor_spike
      loanCount: 200, // > 2×50 → loan_spike
      activeOverdueCount: 100, // > 3×10 → overdue_spike
    };
    // Use a weekday so all four could potentially fire, but visitors > 0
    // so zero_visitors_weekday should NOT appear.
    expect(applyRules(current, baselines, "2026-06-15")).toEqual([
      "visitor_spike",
      "loan_spike",
      "overdue_spike",
    ]);
  });

  it("can emit all four flags together (0 visitors weekday + spikes elsewhere)", () => {
    const current: CurrentMetrics = {
      visitorCount: 0, // weekday → zero_visitors_weekday
      loanCount: 200, // > 2×50
      activeOverdueCount: 100, // > 3×10
    };
    // visitor_spike cannot fire because visitorCount is 0; baseline guard
    // would also block it. So we expect exactly these three.
    expect(applyRules(current, baselines, "2026-06-15")).toEqual([
      "zero_visitors_weekday",
      "loan_spike",
      "overdue_spike",
    ]);
  });
});

describe("anomaly-detector — isWeekday", () => {
  it("returns true for Monday–Friday", () => {
    // 2026-06-15 Mon → 2026-06-19 Fri
    expect(isWeekday("2026-06-15")).toBe(true);
    expect(isWeekday("2026-06-16")).toBe(true);
    expect(isWeekday("2026-06-17")).toBe(true);
    expect(isWeekday("2026-06-18")).toBe(true);
    expect(isWeekday("2026-06-19")).toBe(true);
  });

  it("returns false for Saturday and Sunday", () => {
    // 2026-06-13 Sat, 2026-06-14 Sun
    expect(isWeekday("2026-06-13")).toBe(false);
    expect(isWeekday("2026-06-14")).toBe(false);
  });
});

describe("anomaly-detector — property tests", () => {
  /**
   * Property: every flag returned by applyRules is a member of the
   * canonical ANOMALY_FLAGS set. The detector must never invent new flag
   * strings, since downstream UI and tests enumerate the known set.
   */
  it("returned flags are always a subset of ANOMALY_FLAGS", () => {
    const arbBaselines = fc.record({
      visitor: fc.float({ min: 0, max: 1000, noNaN: true }),
      loan: fc.float({ min: 0, max: 1000, noNaN: true }),
      overdue: fc.float({ min: 0, max: 1000, noNaN: true }),
    });
    const arbCurrent = fc.record({
      visitorCount: fc.integer({ min: 0, max: 10000 }),
      loanCount: fc.integer({ min: 0, max: 10000 }),
      activeOverdueCount: fc.integer({ min: 0, max: 10000 }),
    });
    const arbDate = fc
      .date({
        min: new Date("2020-01-01"),
        max: new Date("2030-12-31"),
        noInvalidDate: true,
      })
      .map((d) => d.toISOString().slice(0, 10));

    fc.assert(
      fc.property(
        fc.record({ baselines: arbBaselines, current: arbCurrent, date: arbDate }),
        ({ baselines, current, date }) => {
          const flags = applyRules(current, baselines, date);
          for (const f of flags) {
            expect(ANOMALY_FLAGS).toContain(f);
          }
        }
      )
    );
  });

  /**
   * Property: applyRules is pure and deterministic — same inputs always
   * produce identical output, including flag ordering.
   */
  it("is deterministic: same inputs → identical output", () => {
    const arbInputs = fc.record({
      baselines: fc.record({
        visitor: fc.float({ min: 0, max: 1000, noNaN: true }),
        loan: fc.float({ min: 0, max: 1000, noNaN: true }),
        overdue: fc.float({ min: 0, max: 1000, noNaN: true }),
      }),
      current: fc.record({
        visitorCount: fc.integer({ min: 0, max: 10000 }),
        loanCount: fc.integer({ min: 0, max: 10000 }),
        activeOverdueCount: fc.integer({ min: 0, max: 10000 }),
      }),
      date: fc
        .date({ min: new Date("2020-01-01"), max: new Date("2030-12-31"), noInvalidDate: true })
        .map((d) => d.toISOString().slice(0, 10)),
    });

    fc.assert(
      fc.property(arbInputs, (inputs) => {
        const a = applyRules(inputs.current, inputs.baselines, inputs.date);
        const b = applyRules(inputs.current, inputs.baselines, inputs.date);
        expect(a).toEqual(b);
      })
    );
  });
});
