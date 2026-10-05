import { describe, expect, it } from "vitest";
import type { ReportListItem, ReportSummary } from "@/lib/types";
import { groupByRating, latestPerTicker } from "@/lib/verdicts";

const item = (id: string, ticker: string, runAt: string, rating?: string): ReportListItem => ({
  id, ticker, runAt, summaryStale: false, hasReport: true,
  summary: rating ? ({ rating } as ReportSummary) : null,
});

describe("latestPerTicker", () => {
  it("keeps only the newest run of each ticker, newest first", () => {
    const out = latestPerTicker([
      item("SPY_old", "SPY", "2026-09-01T10:00:00", "Buy"),
      item("VOO_1", "VOO", "2026-10-04T21:34:24", "Hold"),
      item("SPY_new", "SPY", "2026-10-04T22:04:13", "Hold"),
    ]);
    expect(out.map((r) => r.id)).toEqual(["SPY_new", "VOO_1"]);
  });
});

describe("groupByRating", () => {
  it("places rated runs in their scale column and sets the rest aside", () => {
    const groups = groupByRating(
      [
        item("a", "SPY", "2026-10-04T22:04:13", "Hold"),
        item("b", "VOO", "2026-10-04T21:34:24", "Overweight"),
        item("c", "TSM", "2026-09-17T23:15:50", "Hold"),
        item("d", "GOOGL", "2026-09-18T23:08:22"),
        item("e", "SE", "2026-09-22T08:08:43", "REVIEW"),
      ],
      (r) => r.summary?.rating,
    );
    expect(groups.columns.map((c) => [c.rating, c.items.map((i) => i.ticker)])).toEqual([
      ["Buy", []],
      ["Overweight", ["VOO"]],
      ["Hold", ["SPY", "TSM"]],
      ["Underweight", []],
      ["Sell", []],
    ]);
    expect(groups.unrated.map((i) => i.ticker)).toEqual(["GOOGL", "SE"]);
  });
});

describe("groupByRating with another row shape", () => {
  it("reads the rating through the accessor", () => {
    const rows = [{ t: "NVDA", verdict: "Buy" }, { t: "XYZQ", verdict: null }];
    const groups = groupByRating(rows, (r) => r.verdict);
    expect(groups.columns[0].items.map((r) => r.t)).toEqual(["NVDA"]);
    expect(groups.unrated.map((r) => r.t)).toEqual(["XYZQ"]);
  });
});
