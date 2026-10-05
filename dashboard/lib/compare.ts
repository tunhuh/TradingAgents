import { RATINGS, type ReportSummary } from "@/lib/types";

export interface ComparisonRow {
  ticker: string;
  reportId: string;
  summary: ReportSummary;
}

const rank = (rating: string) => {
  const i = (RATINGS as readonly string[]).indexOf(rating);
  return i === -1 ? RATINGS.length : i;
};

export function sortForComparison(rows: ComparisonRow[]): ComparisonRow[] {
  return [...rows].sort(
    (a, b) => rank(a.summary.rating) - rank(b.summary.rating) || a.ticker.localeCompare(b.ticker),
  );
}
