import { describe, expect, it } from "vitest";
import { benchmarkSentence, levelsSentence, verdictLabel } from "@/lib/outcome-text";
import type { LevelsOutcome, Outcome } from "@/lib/outcomes";

const l = (o: Partial<LevelsOutcome>): LevelsOutcome => ({ verdict: "pending", touched: null, date: null, horizonEnd: "2027-01-04", horizonAssumed: false, note: null, ...o });

describe("outcome text", () => {
  it("labels verdicts", () => {
    expect(["right", "wrong", "pending", "expired", "unscored"].map((v) => verdictLabel(v as never))).toEqual(["Right", "Wrong", "Open", "Expired", "Not scored"]);
  });
  it("describes level outcomes in plain words", () => {
    expect(levelsSentence(l({ verdict: "right", touched: "target", date: "2026-10-12" }))).toBe("Target hit on 12 Oct 2026");
    expect(levelsSentence(l({ verdict: "wrong", touched: "stop", date: "2026-10-12" }))).toBe("Stop hit on 12 Oct 2026");
    expect(levelsSentence(l({ verdict: "wrong", touched: "both", date: "2026-10-12", note: "both levels on the same day" }))).toBe("Target and stop both hit on 12 Oct 2026, counted as a miss");
    expect(levelsSentence(l({}))).toBe("Open until 4 Jan 2027");
    expect(levelsSentence(l({ horizonAssumed: true }))).toBe("Open until 4 Jan 2027 (horizon assumed 3 months)");
    expect(levelsSentence(l({ verdict: "expired" }))).toBe("Neither level hit by 4 Jan 2027");
    expect(levelsSentence(l({ verdict: "unscored", note: "Hold has no direction", touched: "target", date: "2026-10-12" }))).toBe("Hold, not scored on levels (target reached 12 Oct 2026)");
    expect(levelsSentence(l({ verdict: "unscored", note: "no levels" }))).toBe("No target or stop to score");
    expect(levelsSentence(l({ verdict: "unscored", note: "levels don't match the rating" }))).toBe("Target and stop don’t match the rating, not scored");
  });
});


describe("benchmarkSentence", () => {
  const o = (d20: Partial<Outcome["d20"]>, d5: Partial<Outcome["d5"]> = {}) =>
    ({ d5: { days: 5, ret: null, alpha: null, benchmark: "pending", absolute: "pending", ...d5 }, d20: { days: 20, ret: null, alpha: null, benchmark: "pending", absolute: "pending", ...d20 } }) as Outcome;
  it("prefers 20 days, falls back to 5, then pending", () => {
    expect(benchmarkSentence(o({ alpha: 0.031 }), "SPY")).toBe("+3.1% vs SPY after 20 trading days");
    expect(benchmarkSentence(o({}, { alpha: -0.004 }), "SPY")).toBe("−0.4% vs SPY after 5 trading days");
    expect(benchmarkSentence(o({}), "SPY")).toBe("Benchmark comparison pending");
    expect(benchmarkSentence(o({}), null)).toBe("Benchmark comparison pending");
  });
});
