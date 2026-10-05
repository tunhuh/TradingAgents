import { describe, expect, it } from "vitest";
import { sortForComparison, type ComparisonRow } from "@/lib/compare";
import type { ReportSummary } from "@/lib/types";

const row = (ticker: string, rating: string): ComparisonRow => ({
  ticker, reportId: `${ticker}_20261005_101500`, summary: { rating } as ReportSummary,
});

describe("sortForComparison", () => {
  it("orders Buy → Sell, unknown ratings last, ties by ticker", () => {
    const rows = [row("Z", "Hold"), row("A", "Sell"), row("M", "Buy"), row("B", "Hold"), row("Q", "REVIEW"), row("C", "Overweight")];
    expect(sortForComparison(rows).map((r) => r.ticker)).toEqual(["M", "C", "B", "Z", "A", "Q"]);
  });
});
