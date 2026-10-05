import { scoreVerdict, type Bar, type Outcome, type Verdict } from "@/lib/outcomes";
import { readBars, readPriceIndex, type PriceIndex } from "@/lib/prices";
import { listReports } from "@/lib/reports";
import { batchTradeDates, resolveTradeDate, type LogDirCache, type TradeDate } from "@/lib/trade-dates";
import { RATINGS, type Rating, type ReportListItem, type ReportSummary } from "@/lib/types";

export interface Scorecard {
  report: ReportListItem & { summary: ReportSummary };
  tradeDate: TradeDate;
  symbol: string | null;
  benchmark: string | null;
  priceError: string | null;
  outcome: Outcome;
}

export interface MeasureStats {
  right: number;
  wrong: number;
  pending: number;
  notCounted: number;
  rate: number | null;
}

export interface ScoreSummary {
  levels: MeasureStats;
  benchmark: MeasureStats;
  absolute: MeasureStats;
  byRating: { rating: Rating; levels: MeasureStats; benchmark: MeasureStats; absolute: MeasureStats; avgAlpha20: number | null; alphaN: number }[];
}

const isRated = (r: ReportListItem): r is ReportListItem & { summary: ReportSummary } =>
  !!r.summary && (RATINGS as readonly string[]).includes(r.summary.rating);

async function buildCards(reports: (ReportListItem & { summary: ReportSummary })[], index: PriceIndex): Promise<Scorecard[]> {
  const batchMap = await batchTradeDates();
  const logDirs: LogDirCache = new Map();
  const barCache = new Map<string, Promise<Bar[] | null>>();
  const bars = (symbol: string) => {
    if (!barCache.has(symbol)) barCache.set(symbol, readBars(symbol));
    return barCache.get(symbol)!;
  };

  return Promise.all(
    reports.map(async (report) => {
      const tradeDate = await resolveTradeDate(report, batchMap, logDirs);
      const mapping = index.tickers[report.ticker] ?? null;
      const tickerBars = mapping ? await bars(mapping.symbol) : null;
      const benchBars = mapping ? await bars(mapping.benchmark) : null;
      const priceError = !mapping
        ? "Prices haven't been fetched for this ticker yet."
        : index.errors[mapping.symbol] ?? (tickerBars ? null : "No price data for this ticker.");
      const s = report.summary;
      const outcome = scoreVerdict({
        rating: s.rating, tradeDate: tradeDate.date, target: s.price_target, stop: s.stop_loss,
        horizonText: s.time_horizon, bars: tickerBars ?? [], benchmarkBars: benchBars ?? [],
      });
      return { report, tradeDate, symbol: mapping?.symbol ?? null, benchmark: mapping?.benchmark ?? null, priceError, outcome };
    }),
  );
}

/** Scorecards for every rated report, or only `ticker`'s; pass `reports` to reuse a listing. */
export async function loadScorecards(opts: { reports?: ReportListItem[]; ticker?: string } = {}): Promise<Scorecard[]> {
  const reports = (opts.reports ?? (await listReports())).filter((r) => isRated(r) && (!opts.ticker || r.ticker === opts.ticker));
  return buildCards(reports as (ReportListItem & { summary: ReportSummary })[], await readPriceIndex());
}

export async function loadScorecard(reportId: string): Promise<Scorecard | null> {
  const report = (await listReports()).find((r) => r.id === reportId);
  if (!report || !isRated(report)) return null;
  return (await buildCards([report], await readPriceIndex()))[0];
}

export function measureStats(verdicts: Verdict[]): MeasureStats {
  const count = (v: Verdict) => verdicts.filter((x) => x === v).length;
  const right = count("right");
  const wrong = count("wrong");
  return { right, wrong, pending: count("pending"), notCounted: count("expired") + count("unscored"), rate: right + wrong ? right / (right + wrong) : null };
}

export function summarizeScorecards(cards: Scorecard[]): ScoreSummary {
  const stats = (cs: Scorecard[]) => ({
    levels: measureStats(cs.map((c) => c.outcome.levels.verdict)),
    benchmark: measureStats(cs.map((c) => c.outcome.d20.benchmark)),
    absolute: measureStats(cs.map((c) => c.outcome.d20.absolute)),
  });
  return {
    ...stats(cards),
    byRating: RATINGS.map((rating) => {
      const cs = cards.filter((c) => c.report.summary.rating === rating);
      const alphas = cs.map((c) => c.outcome.d20.alpha).filter((a): a is number => a != null);
      return { rating, ...stats(cs), avgAlpha20: alphas.length ? alphas.reduce((a, b) => a + b, 0) / alphas.length : null, alphaN: alphas.length };
    }),
  };
}
