import { RATINGS, type Rating, type ReportListItem } from "@/lib/types";

/** Newest run of each ticker, newest first. */
export function latestPerTicker(reports: ReportListItem[]): ReportListItem[] {
  const latest = new Map<string, ReportListItem>();
  for (const r of reports) {
    const seen = latest.get(r.ticker);
    if (!seen || r.runAt > seen.runAt) latest.set(r.ticker, r);
  }
  return [...latest.values()].sort((a, b) => b.runAt.localeCompare(a.runAt));
}

export interface ScaleColumn<T> {
  rating: Rating;
  items: T[];
}

/** Columns in scale order (Buy → Sell); items without one of the five ratings are set aside. */
export function groupByRating<T>(
  items: T[],
  ratingOf: (item: T) => string | null | undefined,
): { columns: ScaleColumn<T>[]; unrated: T[] } {
  const columns = RATINGS.map((rating) => ({ rating, items: items.filter((i) => ratingOf(i) === rating) }));
  const unrated = items.filter((i) => !(RATINGS as readonly string[]).includes(ratingOf(i) ?? ""));
  return { columns, unrated };
}
