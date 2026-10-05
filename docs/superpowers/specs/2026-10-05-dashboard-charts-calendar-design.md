# Dashboard charts, calendar and verdict scoring — Design

Date: 2026-10-05
Status: Approved in chat; pending spec review
Builds on: `2026-10-05-dashboard-design.md` (dashboard) and the verdict-scale redesign (commit c701ff1).

## Purpose

Let the user see how the committee's verdicts played out and when they were made:

1. **Score each verdict** against later prices three ways (target vs stop as the headline; beat the benchmark; absolute return).
2. **Charts**: per-ticker price with verdict levels, per-ticker rating history, and an overview of hit rates, alpha by rating and run frequency.
3. **Calendar** of runs by day.

Non-goals: intraday prices, live quotes, portfolio P&L / position sizing, earnings or macro event calendars, editing past verdicts.

## Context (repo facts this relies on)

- Summaries (`reports/<id>/summary.json`) hold `rating`, `price_target`, `stop_loss`, `time_horizon` (free text, e.g. "3-6 months", "4-8 weeks (reassess around end of October)").
- Report folders are named by **run time**, not trade date. Trade dates are available from: batch files (`reports/_batches/*.json` → `params.trade_date` + `items[].report_id`), and the CLI's log folders `~/.tradingagents/logs/<TICKER>/<YYYY-MM-DD>/` (`results_dir`, overridable by `TRADINGAGENTS_RESULTS_DIR`). Some folders there are not dates (e.g. `TradingAgentsStrategy_logs`).
- The framework's outcome measure (`TradingAgentsGraph._fetch_returns`) is raw and alpha return over 5 trading days vs a benchmark from `_resolve_benchmark` (config `benchmark_ticker`, else `benchmark_map` by exchange suffix, default `SPY`). Symbols are canonicalized with `tradingagents.dataflows.symbol_utils.normalize_symbol`.
- `yfinance` is already a dependency. The memory log has too few resolved entries to be a data source.
- UI: Next.js 16 App Router, Tailwind v4, ledger palette and rating scale tokens in `app/globals.css`.

## Scoring rules (`lib/outcomes.ts`, pure)

Inputs per verdict: `rating`, `tradeDate`, `target`, `stop`, `horizonText`, ticker daily bars `{date, high, low, close}[]`, benchmark daily bars, `today`.

**Entry**: close of the last bar with `date <= tradeDate`. No such bar → every measure `unscored` ("no price data").

**Windows**: trading days are bar indices after the entry bar. Return at N days = `close[entry+N] / entry - 1`; alpha at N = that minus the benchmark's return over the same dates (benchmark entry = its last bar `<= tradeDate`). A window is `pending` until bar `entry+N` exists in both series.

### 1. Target vs stop (headline)
- Direction: Buy/Overweight = long (target above entry, stop below). Sell/Underweight = short (target below, stop above). Hold = not scored (`unscored`, "Hold has no direction"), but which level was touched first is still reported.
- Missing target or stop → `unscored` ("no levels"). Levels on the wrong side of entry for the direction → `unscored` ("levels don't match the rating").
- Walk bars after the entry bar up to the horizon end: long — target touched when `high >= target`, stop when `low <= stop`; short — target when `low <= target`, stop when `high >= stop`. First touch decides: target → `right`, stop → `wrong`. Both on the same bar → `wrong` (conservative), flagged "both levels on the same day".
- Horizon end = trade date + horizon. `parseHorizon(text)`: take the **upper** number of the first `N`, `N-M`, or `N–M` followed by day(s)/week(s)/month(s)/year(s) (case-insensitive); unparseable or missing → 3 months. Neither level touched and horizon end `<= today` → `expired` (not counted). Otherwise `open` (pending).

### 2. Beat the benchmark (20 trading days for the hit rate; 5 days shown too)
- Buy/Overweight `right` if alpha > 0; Sell/Underweight `right` if alpha < 0; Hold `right` if |alpha| <= 2%. Otherwise `wrong`. Window incomplete → `pending`.

### 3. Absolute return (20 trading days for the hit rate; 5 days shown too)
- Same rules on raw return.

**Hit rate** for a measure = right / (right + wrong) over scored verdicts; always reported with counts of right, wrong, pending (open + pending) and not counted (expired + unscored). With 0 settled, the rate is shown as "—".

`REVIEW` ratings and reports without a summary are excluded from all scoring.

## Data

### Trade dates (`lib/trade-dates.ts`)
Resolution order for a report:
1. `reports/<id>/meta.json` → `trade_date` (written by the batch worker from now on).
2. A batch file whose `items[].report_id` equals the id → its `params.trade_date`.
3. CLI log folders: `<results_dir>/<TICKER>/<YYYY-MM-DD>/` — the latest valid date `<=` the run date and `>=` run date − 7 days. `results_dir` = env `TA_RESULTS_DIR`, else `~/.tradingagents/logs`.
4. The run date (date part of the folder name / mtime).

The resolved value carries its `source` (`meta` | `batch` | `cli-log` | `run-date`) so the UI can say "trade date inferred from run date" when it is a guess.

**Worker change**: `run_batch._run_one` writes `meta.json` `{ticker, trade_date, asset_type, analysts, batch_id}` into the new report folder after `save_reports`.

### Prices
- New worker `python -m dashboard.worker.prices <TICKER> [<TICKER> ...]`:
  - For each ticker: symbol = `normalize_symbol(ticker)`; benchmark = the framework's `_resolve_benchmark` logic applied to the config (reuse via `TradingAgentsGraph._resolve_benchmark(SimpleNamespace(config=...))`).
  - Fetch daily history with `yfinance` for every distinct symbol (tickers + benchmarks), `start` = 2 years ago (enough for all reports and charts), `auto_adjust=False`, write `reports/_prices/<SYMBOL>.json` = `{symbol, fetched_at, bars: [{date, open, high, low, close}]}` atomically.
  - Write `reports/_prices/_index.json` = `{fetched_at, tickers: {<TICKER>: {symbol, benchmark}}, errors: {<SYMBOL>: "<message>"}}`, merged with the existing index.
  - A failing symbol is recorded in `errors` and does not stop the others. Exit 0 if at least one symbol was fetched, else 1.
  - Symbol file names go through `safe_ticker_component` (e.g. `^GSPC` and `GC=F` are allowed).
- `lib/prices.ts` reads the cache: `readPriceIndex()`, `readBars(symbol)`, `pricesStale(index, now)` (missing or `fetched_at` older than 12 h).
- `POST /api/prices/refresh` (local-request guard, like the other mutating routes) runs the worker for every ticker that has a report, with a 120 s timeout; 200 `{fetched_at, errors}` or 500 with the last stderr line. Only one refresh at a time (a second request while one runs gets 409).
- `<PriceFreshness>` (client) shows "Prices updated 5 Oct 2026, 18:00" and a **Refresh prices** button; when the cache is stale or missing it triggers one refresh on mount, then `router.refresh()`. Shown on the pages that use prices: Insights, ticker page and report page (not Calendar, which needs no prices).

### Assembled view model (`lib/scorecard.ts`, server)
`loadScorecards()` → for every report with a summary: `{report, tradeDate, tradeDateSource, symbol, benchmark, outcome}` using the cache. `scoreSummary(scorecards)` → per measure: counts + hit rate, overall and by rating; average 20-day alpha by rating (settled only, with n).

## Pages and components

Nav becomes: Verdicts · Calendar · Insights · Batches · New batch (rendered as separate links, no separators).

### Calendar — `/calendar?month=YYYY-MM&day=YYYY-MM-DD`
- `lib/calendar.ts` (pure): `monthGrid(month)` → 6×7 or fewer weeks of dates, Monday-first, with `inMonth` flags; `runsByDay(reports)` keyed by run date (local).
- Default month = month of the latest run (or the current month when there are none). Previous/next month links; header "October 2026".
- Each day cell: day number; up to 3 runs as ticker text with a rating swatch (unsummarized = hollow swatch); "+N more"; today outlined; days outside the month muted. Cell is a link to `?month=…&day=…`.
- Selected day: list below the grid of that day's reports (ticker, run time, rating, link). Default selection: none.
- Mobile: the grid stays 7 columns with compact cells (day number + up to 2 swatches + count), the list carries the detail.

### Insights — `/insights`
- Hero: target-vs-stop hit rate as a large figure with the right and wrong counts as two separately labelled numbers, plus open and not-counted counts.
- Beside it: beat-the-benchmark (20 d) and absolute (20 d) hit rates as smaller figures with their counts.
- Chart A — **Hit rate by rating** (horizontal bars, one per rating that has settled outcomes, 0–100%, for the selected measure; measure chosen with a 3-option toggle above the chart). Bar colour = the rating's colour; direct value labels.
- Chart B — **Average 20-day alpha by rating** (diverging horizontal bars around 0%, coloured by rating, label shows value and n).
- Chart C — **Runs per week** (columns, single ink colour, last 26 weeks, from run dates).
- Each chart has a "Show table" disclosure with the same data.
- Empty states explain what's missing ("No settled verdicts yet. Target-vs-stop outcomes settle when a level is touched or the horizon ends.").

### Ticker — `/tickers/[ticker]`
- Header: ticker in display type, latest rating marker, link back to the latest report.
- Chart D — **Price** (line, close, ink colour, 2 px) over the range from 30 trading days before the first trade date to today. Each run = a dot (≥ 8 px, rating colour, 2 px surface ring) at its trade date's close. Selected run's target and stop drawn as dashed horizontal reference lines labelled "Target 785" / "Stop 758". Selecting a run = clicking its dot or its table row (`?run=<reportId>`, default latest). Crosshair tooltip: date, close, and any run on that date.
- Chart E — **Rating history** (step line on a 5-step y axis labelled Buy…Sell, same x domain as Chart D, points coloured by rating). Separate chart directly below D — never a second y-axis on D.
- Runs table: run time, trade date (with "inferred" note when the source is `run-date`), rating, entry, target, stop, levels outcome (with date), 5 d and 20 d return and alpha, and right/wrong/pending per measure.
- No price data (fetch failed or symbol unknown): charts replaced by the error message and the Refresh button; table still lists runs.

### Report page (existing)
- Header gains one outcome line when a summary exists, e.g. "Target hit on 12 Oct 2026" / "Stop hit on …" / "Open until 4 Jan 2027" / "Hold — not scored on levels", and "+3.1% vs SPY after 20 trading days" (or "pending"). Plus a link "Price and history" → `/tickers/<ticker>`.

### Verdicts home (existing)
- Ticker names on the scale stay links to the latest report (no change). The "All runs" table gains nothing; the ticker page is reached from reports and the Insights/Calendar pages.

## Charts — implementation rules
- Library: **Recharts** (client components; data passed from server components as plain JSON).
- Marks: 2 px lines; markers ≥ 8 px with a 2 px surface ring; bars with 4 px rounded data-ends and a 2 px surface gap; recessive grid (`--border`) and axes (`--muted-foreground` text, no axis line on the value axis); text never in series colours.
- One y-axis per chart. Rating identity is never colour-alone: ratings are always labelled (axis labels, direct labels, or table).
- Colours from CSS tokens (read via `getComputedStyle` once on mount so light/dark both work); price line = `--foreground`; benchmark (if drawn) = `--muted-foreground`.
- Each chart has a table view. Tooltips on hover and keyboard focus.

### Palette update (validated)
Light-mode rating colours change to clear the 2:1 mark-contrast floor on the ledger surface (validated with the dataviz `validate_palette.js --ordinal` per diverging arm, all checks pass):
- Overweight `#93b2e3` → `#6f94d6`
- Underweight `#f0b865` → `#d6923a`
- Sell `#a8520a` → `#9a4a08`
Buy `#1f4fa3` unchanged; dark-mode values unchanged (already pass). Hold `#c8c3b6` stays the neutral midpoint (marks in Hold always carry a text label).

## Error handling

| Case | Behaviour |
|---|---|
| Price fetch fails for a symbol | recorded in `_index.json.errors`; that ticker's charts show the error + Refresh; scoring for its verdicts = `unscored` ("no price data") |
| Cache missing / stale | pages render from what exists, `<PriceFreshness>` triggers one refresh |
| Refresh already running | 409; the button shows "Already refreshing" |
| Python not found | 500 naming `TA_PYTHON` (same as other workers) |
| Trade date only guessed | scoring proceeds; UI marks it "inferred from run date" |
| Unparseable horizon | 3-month default; ticker table shows "horizon assumed 3 months" |
| Unknown ticker route | 404 |

## Testing
- **vitest**: `outcomes.ts` (entry selection; long/short target-first, stop-first, same-day both → wrong; Hold unscored on levels but scored on benchmark/absolute ±2%; mismatched levels; missing levels; expired vs open around the horizon end; 5/20-day pending until bars exist; benchmark misalignment); `parseHorizon` (ranges with hyphen and en dash, weeks/months/years/days, parentheses text, garbage → 3 months); `trade-dates.ts` (each source in priority order, non-date log folders ignored, 7-day window); `calendar.ts` (Monday-first grid across month/year boundaries, runsByDay); `scorecard` hit-rate math (0 settled → null rate); runs-per-week bucketing.
- **pytest**: `prices.py` with a monkeypatched `yfinance` (writes symbol files and index; one failing symbol recorded while others succeed; exit codes; benchmark resolution `^`/suffix tickers); `run_batch` writes `meta.json`.
- **Visual**: screenshots of Calendar, Insights, Ticker, Report in light, dark and 390 px; palette re-validated after the token change.
