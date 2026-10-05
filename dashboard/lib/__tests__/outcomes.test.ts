import { describe, expect, it } from "vitest";
import { addHorizon, parseHorizon, scoreVerdict, type Bar } from "@/lib/outcomes";

/** Weekday bars starting at `start`; each spec is a close, or [low, high, close]. */
function bars(start: string, specs: (number | [number, number, number])[]): Bar[] {
  const out: Bar[] = [];
  const d = new Date(`${start}T00:00:00Z`);
  for (const s of specs) {
    while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 1);
    const [low, high, close] = typeof s === "number" ? [s, s, s] : s;
    out.push({ date: d.toISOString().slice(0, 10), low, high, close });
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}
const flat = (start: string, n: number, v = 100) => bars(start, Array(n).fill(v));
const base = { tradeDate: "2026-09-01", horizonText: "3 months" };

describe("parseHorizon / addHorizon", () => {
  it.each([
    ["3-6 months", 6, "month", false],
    ["4–8 weeks (reassess around end of October)", 8, "week", false],
    ["6 to 12 months", 12, "month", false],
    ["10 days", 10, "day", false],
    ["1 year", 1, "year", false],
    ["Medium term", 3, "month", true],
    [null, 3, "month", true],
  ])("%j → %d %s", (text, amount, unit, assumed) => {
    expect(parseHorizon(text as string | null)).toEqual({ amount, unit, assumed });
  });
  it("adds calendar units", () => {
    expect(addHorizon("2026-09-01", { amount: 8, unit: "week", assumed: false })).toBe("2026-10-27");
    expect(addHorizon("2026-01-31", { amount: 1, unit: "month", assumed: false })).toBe("2026-03-03");
    expect(addHorizon("2026-09-01", { amount: 10, unit: "day", assumed: false })).toBe("2026-09-11");
  });
});

describe("entry", () => {
  it("entry uses the last close on or before the trade date", () => {
    const b = bars("2026-08-27", [99, 100, 101]); // Thu 27, Fri 28, Mon 31 Aug
    const o = scoreVerdict({ ...base, tradeDate: "2026-08-30", rating: "Buy", target: 110, stop: 90, bars: b, benchmarkBars: b });
    expect(o.entry).toEqual({ date: "2026-08-28", close: 100 });
  });
  it("no bar on or before the trade date → everything unscored", () => {
    const b = flat("2026-09-02", 30);
    const o = scoreVerdict({ ...base, rating: "Buy", target: 110, stop: 90, bars: b, benchmarkBars: b });
    expect(o.entry).toBeNull();
    expect(o.levels.verdict).toBe("unscored");
    expect(o.d20.benchmark).toBe("unscored");
    expect(o.note).toBe("no price data");
  });
});

describe("target vs stop", () => {
  it("long: target first is right, stop first is wrong", () => {
    const up = bars("2026-09-01", [100, [99, 105, 104], [103, 111, 110]]);
    expect(scoreVerdict({ ...base, rating: "Buy", target: 110, stop: 90, bars: up, benchmarkBars: up }).levels)
      .toMatchObject({ verdict: "right", touched: "target", date: "2026-09-03" });
    const down = bars("2026-09-01", [100, [89, 101, 95]]);
    expect(scoreVerdict({ ...base, rating: "Overweight", target: 110, stop: 90, bars: down, benchmarkBars: down }).levels)
      .toMatchObject({ verdict: "wrong", touched: "stop", date: "2026-09-02" });
  });
  it("short: target below, stop above", () => {
    const fall = bars("2026-09-01", [100, [84, 101, 85]]);
    expect(scoreVerdict({ ...base, rating: "Sell", target: 85, stop: 110, bars: fall, benchmarkBars: fall }).levels.verdict).toBe("right");
    const rise = bars("2026-09-01", [100, [99, 111, 110]]);
    expect(scoreVerdict({ ...base, rating: "Underweight", target: 85, stop: 110, bars: rise, benchmarkBars: rise }).levels.verdict).toBe("wrong");
  });
  it("both levels on the same day counts as wrong", () => {
    const wild = bars("2026-09-01", [100, [85, 115, 100]]);
    expect(scoreVerdict({ ...base, rating: "Buy", target: 110, stop: 90, bars: wild, benchmarkBars: wild }).levels)
      .toMatchObject({ verdict: "wrong", touched: "both", note: "both levels on the same day" });
  });
  it("Hold is not scored on levels but still reports the first touch", () => {
    const up = bars("2026-09-01", [100, [99, 111, 110]]);
    expect(scoreVerdict({ ...base, rating: "Hold", target: 110, stop: 90, bars: up, benchmarkBars: up }).levels)
      .toMatchObject({ verdict: "unscored", touched: "target", note: "Hold has no direction" });
  });
  it("missing or mismatched levels are not scored", () => {
    const b = flat("2026-09-01", 5);
    expect(scoreVerdict({ ...base, rating: "Buy", target: null, stop: 90, bars: b, benchmarkBars: b }).levels)
      .toMatchObject({ verdict: "unscored", note: "no levels" });
    expect(scoreVerdict({ ...base, rating: "Buy", target: 95, stop: 90, bars: b, benchmarkBars: b }).levels)
      .toMatchObject({ verdict: "unscored", note: "levels don't match the rating" });
  });
  it("expires when neither level is touched by the horizon end", () => {
    const b = flat("2026-09-01", 60); // through late November
    const o = scoreVerdict({ ...base, horizonText: "4 weeks", rating: "Buy", target: 110, stop: 90, bars: b, benchmarkBars: b });
    expect(o.levels).toMatchObject({ verdict: "expired", horizonEnd: "2026-09-29" });
  });
  it("stays open when bars stop before the horizon end", () => {
    const b = flat("2026-09-01", 10);
    expect(scoreVerdict({ ...base, rating: "Buy", target: 110, stop: 90, bars: b, benchmarkBars: b }).levels.verdict).toBe("pending");
  });
  it("ignores touches after the horizon end", () => {
    const b = [...flat("2026-09-01", 25), ...bars("2026-10-06", [[99, 120, 119]])];
    expect(scoreVerdict({ ...base, horizonText: "4 weeks", rating: "Buy", target: 110, stop: 90, bars: b, benchmarkBars: b }).levels.verdict).toBe("expired");
  });
});

describe("benchmark and absolute windows", () => {
  const rising = bars("2026-09-01", Array.from({ length: 25 }, (_, i) => 100 + i)); // +20% by day 20
  const index = bars("2026-09-01", Array.from({ length: 25 }, (_, i) => 100 + i / 2)); // +10% by day 20

  it("computes returns and alpha at 5 and 20 trading days", () => {
    const o = scoreVerdict({ ...base, rating: "Buy", target: 200, stop: 50, bars: rising, benchmarkBars: index });
    expect(o.d5.ret).toBeCloseTo(0.05);
    expect(o.d20.ret).toBeCloseTo(0.2);
    expect(o.d20.alpha).toBeCloseTo(0.1);
    expect(o.d20).toMatchObject({ benchmark: "right", absolute: "right" });
  });
  it("short ratings are right when below; Hold is right within ±2%", () => {
    expect(scoreVerdict({ ...base, rating: "Sell", target: 50, stop: 200, bars: rising, benchmarkBars: index }).d20)
      .toMatchObject({ benchmark: "wrong", absolute: "wrong" });
    const calm = bars("2026-09-01", Array(25).fill(100).map((v, i) => (i === 20 ? 101 : v)));
    expect(scoreVerdict({ ...base, rating: "Hold", target: 110, stop: 90, bars: calm, benchmarkBars: flat("2026-09-01", 25) }).d20)
      .toMatchObject({ benchmark: "right", absolute: "right" });
  });
  it("is pending until the window has traded", () => {
    const o = scoreVerdict({ ...base, rating: "Buy", target: 200, stop: 50, bars: rising.slice(0, 10), benchmarkBars: index.slice(0, 10) });
    expect(o.d5.benchmark).toBe("right");
    expect(o.d20).toMatchObject({ ret: null, alpha: null, benchmark: "pending", absolute: "pending" });
  });
  it("alpha is pending until the benchmark has the bar too", () => {
    const o = scoreVerdict({ ...base, rating: "Buy", target: 200, stop: 50, bars: rising, benchmarkBars: index.slice(0, 12) });
    expect(o.d20.ret).toBeCloseTo(0.2);
    expect(o.d20).toMatchObject({ alpha: null, benchmark: "pending", absolute: "right" });
  });
});
