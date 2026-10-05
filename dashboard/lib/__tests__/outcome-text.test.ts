import { describe, expect, it } from "vitest";
import { levelsSentence, verdictLabel } from "@/lib/outcome-text";
import type { LevelsOutcome } from "@/lib/outcomes";

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
