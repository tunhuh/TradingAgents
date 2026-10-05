import { describe, expect, it } from "vitest";
import type { Outcome, Verdict } from "@/lib/outcomes";
import { measureStats, summarizeScorecards, type Scorecard } from "@/lib/scorecard";
import type { ReportSummary } from "@/lib/types";
import { formatPercent, formatRate } from "@/lib/format";

describe("measureStats", () => {
  it("counts right/wrong/pending/not counted and computes the rate over settled ones", () => {
    const v: Verdict[] = ["right", "right", "wrong", "pending", "expired", "unscored"];
    expect(measureStats(v)).toEqual({ right: 2, wrong: 1, pending: 1, notCounted: 2, rate: 2 / 3 });
  });
  it("has no rate with nothing settled", () => {
    expect(measureStats(["pending", "expired"]).rate).toBeNull();
  });
});

const card = (rating: string, levels: Verdict, bench: Verdict, abs: Verdict, alpha: number | null): Scorecard => ({
  report: { id: rating + Math.random(), ticker: "X", runAt: "2026-10-01T00:00:00", summaryStale: false, hasReport: true, summary: { rating } as ReportSummary },
  tradeDate: { date: "2026-10-01", source: "batch" },
  symbol: "X", benchmark: "SPY", priceError: null,
  outcome: {
    entry: { date: "2026-10-01", close: 1 },
    levels: { verdict: levels, touched: null, date: null, horizonEnd: "2027-01-01", horizonAssumed: false, note: null },
    d5: { days: 5, ret: null, alpha: null, benchmark: "pending", absolute: "pending" },
    d20: { days: 20, ret: alpha, alpha, benchmark: bench, absolute: abs },
    note: null,
  } as Outcome,
});

describe("summarizeScorecards", () => {
  it("summarizes overall and by rating, averaging settled 20-day alpha", () => {
    const s = summarizeScorecards([
      card("Buy", "right", "right", "right", 0.04),
      card("Buy", "wrong", "wrong", "right", -0.02),
      card("Hold", "unscored", "right", "right", 0.01),
      card("Sell", "pending", "pending", "pending", null),
    ]);
    expect(s.levels).toMatchObject({ right: 1, wrong: 1, pending: 1, notCounted: 1, rate: 0.5 });
    const buy = s.byRating.find((r) => r.rating === "Buy")!;
    expect(buy.avgAlpha20).toBeCloseTo(0.01);
    expect(buy.alphaN).toBe(2);
    expect(s.byRating.map((r) => r.rating)).toEqual(["Buy", "Overweight", "Hold", "Underweight", "Sell"]);
    expect(s.byRating.find((r) => r.rating === "Sell")!.avgAlpha20).toBeNull();
  });
});

describe("formatPercent / formatRate", () => {
  it("formats", () => {
    expect(formatPercent(0.0312, { signed: true })).toBe("+3.1%");
    expect(formatPercent(-0.02, { signed: true })).toBe("−2.0%");
    expect(formatPercent(null)).toBe("—");
    expect(formatRate(2 / 3)).toBe("67%");
    expect(formatRate(null)).toBe("—");
  });
});
