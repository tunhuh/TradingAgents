import { describe, expect, it } from "vitest";
import { buildPriceSeries } from "@/lib/ticker-series";

const bars = ["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02"].map((date, i) => ({ date, high: 0, low: 0, close: 100 + i }));
const card = (id: string, runAt: string, rating: string, entry: string | null) => ({
  report: { id, runAt, summary: { rating } }, outcome: { entry: entry ? { date: entry } : null },
});

describe("buildPriceSeries", () => {
  it("puts runs on their entry bar, merges runs that share a bar, and steps the rating forward", () => {
    const s = buildPriceSeries(bars, [
      card("a", "2026-09-30T10:00:00", "Buy", "2026-09-30"),
      card("b", "2026-09-30T22:00:00", "Hold", "2026-09-30"),
      card("c", "2026-10-02T09:00:00", "Sell", "2026-10-02"),
      card("d", "2026-10-02T09:00:00", "Buy", null), // no entry → not on the chart
    ], 1);
    expect(s.map((p) => p.date)).toEqual(["2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02"]); // 1 lead bar
    expect(s[1].runs.map((r) => r.reportId)).toEqual(["a", "b"]);
    expect(s.map((p) => p.ratingStep)).toEqual([null, 2, 2, 0]); // latest run that day wins: Hold, then Sell
  });
  it("returns [] without bars", () => {
    expect(buildPriceSeries([], [])).toEqual([]);
  });
});
