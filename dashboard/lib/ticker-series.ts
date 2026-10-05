import type { Bar } from "@/lib/outcomes";
import { RATINGS } from "@/lib/types";

export interface SeriesRun {
  reportId: string;
  rating: string;
  runAt: string;
}

export interface PricePoint {
  date: string;
  close: number;
  runs: SeriesRun[];
  /** 4 = Buy … 0 = Sell, carried forward from the latest run on or before this bar. */
  ratingStep: number | null;
}

interface CardLike {
  report: { id: string; runAt: string; summary: { rating: string } };
  outcome: { entry: { date: string } | null };
}

const step = (rating: string) => {
  const i = (RATINGS as readonly string[]).indexOf(rating);
  return i < 0 ? null : RATINGS.length - 1 - i;
};

/** Close series from `leadBars` before the first run to the end, with runs placed on their entry bar. */
export function buildPriceSeries(bars: Bar[], cards: CardLike[], leadBars = 30): PricePoint[] {
  if (!bars.length) return [];
  const runsByDate = new Map<string, SeriesRun[]>();
  for (const c of [...cards].sort((a, b) => a.report.runAt.localeCompare(b.report.runAt))) {
    if (!c.outcome.entry) continue;
    const list = runsByDate.get(c.outcome.entry.date) ?? [];
    list.push({ reportId: c.report.id, rating: c.report.summary.rating, runAt: c.report.runAt });
    runsByDate.set(c.outcome.entry.date, list);
  }
  const firstRun = bars.findIndex((b) => runsByDate.has(b.date));
  const start = firstRun < 0 ? Math.max(0, bars.length - 120) : Math.max(0, firstRun - leadBars);

  let current: number | null = null;
  return bars.slice(start).map((b) => {
    const runs = runsByDate.get(b.date) ?? [];
    if (runs.length) current = step(runs[runs.length - 1].rating);
    return { date: b.date, close: b.close, runs, ratingStep: current };
  });
}
