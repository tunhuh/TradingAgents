// Pure scoring of a verdict against later daily prices. See the spec's "Scoring rules".

export interface Bar {
  date: string;
  high: number;
  low: number;
  close: number;
  open?: number;
}

export type Verdict = "right" | "wrong" | "pending" | "expired" | "unscored";
type Unit = "day" | "week" | "month" | "year";
export interface Horizon {
  amount: number;
  unit: Unit;
  assumed: boolean;
}

export interface LevelsOutcome {
  verdict: Verdict;
  touched: "target" | "stop" | "both" | null;
  date: string | null;
  horizonEnd: string;
  horizonAssumed: boolean;
  note: string | null;
}

export interface WindowOutcome {
  days: number;
  ret: number | null;
  alpha: number | null;
  benchmark: Verdict;
  absolute: Verdict;
}

export interface Outcome {
  entry: { date: string; close: number } | null;
  levels: LevelsOutcome;
  d5: WindowOutcome;
  d20: WindowOutcome;
  note: string | null;
}

export interface VerdictInput {
  rating: string;
  tradeDate: string;
  target: number | null;
  stop: number | null;
  horizonText: string | null;
  bars: Bar[];
  benchmarkBars: Bar[];
}

export const HOLD_BAND = 0.02;
const DEFAULT_HORIZON: Horizon = { amount: 3, unit: "month", assumed: true };
const LONG = new Set(["Buy", "Overweight"]);
const SHORT = new Set(["Underweight", "Sell"]);

// "3-6 months", "4–8 weeks", "6 to 12 months", "12-month", "30 trading days", "1-2 quarters".
const HORIZON_RE = /\b(\d+)(?:\s*(?:-|–|—|to)\s*(\d+))?[\s-]*(?:trading\s+)?(day|week|month|quarter|year)s?\b/i;
// Beyond these, the number is almost certainly not a duration (e.g. "into 2027 year-end").
const MAX_AMOUNT: Record<Unit, number> = { day: 1000, week: 260, month: 60, year: 10 };

export function parseHorizon(text: string | null): Horizon {
  const m = text ? HORIZON_RE.exec(text) : null;
  if (!m) return DEFAULT_HORIZON;
  let amount = Number(m[2] ?? m[1]);
  let unit = m[3].toLowerCase() as Unit | "quarter";
  if (unit === "quarter") {
    amount *= 3;
    unit = "month";
  }
  if (amount < 1 || amount > MAX_AMOUNT[unit]) return DEFAULT_HORIZON;
  return { amount, unit, assumed: false };
}

export function addHorizon(date: string, h: Horizon): string {
  const d = new Date(`${date}T00:00:00Z`);
  if (h.unit === "day") d.setUTCDate(d.getUTCDate() + h.amount);
  if (h.unit === "week") d.setUTCDate(d.getUTCDate() + 7 * h.amount);
  if (h.unit === "month") d.setUTCMonth(d.getUTCMonth() + h.amount);
  if (h.unit === "year") d.setUTCFullYear(d.getUTCFullYear() + h.amount);
  return d.toISOString().slice(0, 10);
}

/** Index of the last bar on or before `date`, or -1. Bars are ascending by date. */
function lastIndexOnOrBefore(bars: Bar[], date: string): number {
  let found = -1;
  for (let i = 0; i < bars.length && bars[i].date <= date; i++) found = i;
  return found;
}

function direction(rating: string): 1 | -1 | 0 {
  return LONG.has(rating) ? 1 : SHORT.has(rating) ? -1 : 0;
}

function judge(rating: string, value: number | null): Verdict {
  if (value == null) return "pending";
  const dir = direction(rating);
  if (dir === 1) return value > 0 ? "right" : "wrong";
  if (dir === -1) return value < 0 ? "right" : "wrong";
  return Math.abs(value) <= HOLD_BAND + 1e-9 ? "right" : "wrong"; // tolerance: 102/100 - 1 isn't exactly 0.02
}

function scoreLevels(input: VerdictInput, entryIdx: number): LevelsOutcome {
  const h = parseHorizon(input.horizonText);
  const horizonEnd = addHorizon(input.tradeDate, h);
  const base = { horizonEnd, horizonAssumed: h.assumed };
  const { target, stop, bars } = input;
  if (target == null || stop == null) return { ...base, verdict: "unscored", touched: null, date: null, note: "no levels" };

  const dir = direction(input.rating);
  const entry = bars[entryIdx].close;
  const mismatch = (dir === 1 && !(target > entry && stop < entry)) || (dir === -1 && !(target < entry && stop > entry));
  if (mismatch) return { ...base, verdict: "unscored", touched: null, date: null, note: "levels don't match the rating" };

  // Hold has no direction of its own; read touches using the levels' geometry.
  const touchDir = dir !== 0 ? dir : target >= stop ? 1 : -1;
  let touched: LevelsOutcome["touched"] = null;
  let date: string | null = null;
  for (let i = entryIdx + 1; i < bars.length && bars[i].date <= horizonEnd; i++) {
    const b = bars[i];
    const hitTarget = touchDir === 1 ? b.high >= target : b.low <= target;
    const hitStop = touchDir === 1 ? b.low <= stop : b.high >= stop;
    if (hitTarget || hitStop) {
      touched = hitTarget && hitStop ? "both" : hitTarget ? "target" : "stop";
      date = b.date;
      break;
    }
  }

  if (dir === 0) return { ...base, verdict: "unscored", touched, date, note: "Hold has no direction" };
  if (touched) {
    return { ...base, verdict: touched === "target" ? "right" : "wrong", touched, date, note: touched === "both" ? "both levels on the same day" : null };
  }
  // Only call it expired once prices actually reach the horizon end; stale data stays open.
  const lastDate = bars[bars.length - 1]?.date ?? "";
  return { ...base, verdict: lastDate >= horizonEnd ? "expired" : "pending", touched: null, date: null, note: null };
}

function scoreWindow(input: VerdictInput, entryIdx: number, days: number): WindowOutcome {
  const { bars, benchmarkBars, rating } = input;
  const i = entryIdx + days;
  if (i >= bars.length) return { days, ret: null, alpha: null, benchmark: "pending", absolute: "pending" };
  const ret = bars[i].close / bars[entryIdx].close - 1;

  // The benchmark's last close on or before the window end — its calendar may differ (crypto
  // trades on weekends, the index doesn't). Only once the benchmark has data on or after that
  // date, so a lagging or stale benchmark series leaves alpha pending.
  let alpha: number | null = null;
  const benchEntry = lastIndexOnOrBefore(benchmarkBars, input.tradeDate);
  const benchEnd = lastIndexOnOrBefore(benchmarkBars, bars[i].date);
  const benchCovers = (benchmarkBars[benchmarkBars.length - 1]?.date ?? "") >= bars[i].date;
  if (benchEntry >= 0 && benchEnd >= benchEntry && benchCovers) {
    alpha = ret - (benchmarkBars[benchEnd].close / benchmarkBars[benchEntry].close - 1);
  }
  return { days, ret, alpha, benchmark: judge(rating, alpha), absolute: judge(rating, ret) };
}

export function scoreVerdict(input: VerdictInput): Outcome {
  const entryIdx = lastIndexOnOrBefore(input.bars, input.tradeDate);
  if (entryIdx < 0) {
    const h = parseHorizon(input.horizonText);
    const none = { ret: null, alpha: null, benchmark: "unscored", absolute: "unscored" } as const;
    return {
      entry: null,
      levels: { verdict: "unscored", touched: null, date: null, horizonEnd: addHorizon(input.tradeDate, h), horizonAssumed: h.assumed, note: "no price data" },
      d5: { days: 5, ...none },
      d20: { days: 20, ...none },
      note: "no price data",
    };
  }
  return {
    entry: { date: input.bars[entryIdx].date, close: input.bars[entryIdx].close },
    levels: scoreLevels(input, entryIdx),
    d5: scoreWindow(input, entryIdx, 5),
    d20: scoreWindow(input, entryIdx, 20),
    note: null,
  };
}
