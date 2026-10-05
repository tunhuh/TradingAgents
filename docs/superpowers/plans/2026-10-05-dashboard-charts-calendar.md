# Dashboard Charts, Calendar and Verdict Scoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Score every summarized verdict against later prices (target vs stop, beat the benchmark, absolute), and add a runs calendar, an Insights page, per-ticker price and rating-history charts, and an outcome line on report pages.

**Architecture:** A new Python worker caches daily prices from yfinance into `reports/_prices/` (same file-only interface as the other workers). Trade dates are resolved in TypeScript from `meta.json` → batch files → CLI log folders → run date. A pure TypeScript scoring module turns (verdict, prices) into outcomes; server components assemble scorecards and pass plain JSON to Recharts client charts.

**Tech Stack:** Next.js 16 App Router, TypeScript, Tailwind v4, Recharts 3, vitest; Python 3.12 + yfinance + pytest.

**Spec:** `docs/superpowers/specs/2026-10-05-dashboard-charts-calendar-design.md`

## Global Constraints

- No changes under `tradingagents/` or `cli/`; workers only import them.
- No new Python dependencies (yfinance, pandas already installed). New JS dependencies: `recharts`, `react-is` only.
- Python workers: `python -m dashboard.worker.<name>`, cwd = repo root, atomic JSON writes via `common.write_json_atomic`.
- Mutating API routes call `localRequestError(req)` first (403 on failure).
- Measure names in the UI: "Target vs stop", "Beat the benchmark", "Absolute return". Verdict labels: Right, Wrong, Open (pending), Expired, Not scored.
- Hold band for benchmark and absolute measures: |value| <= 2% (0.02). Hit-rate windows: 20 trading days; 5 days shown alongside.
- Default horizon when unparseable or missing: 3 months.
- Trade-date CLI log window: latest `YYYY-MM-DD` folder `<=` run date and `>=` run date − 7 days. `results_dir` = env `TA_RESULTS_DIR`, else `~/.tradingagents/logs`.
- Prices: 730 days of history; cache stale after 12 hours.
- Charts: one y-axis per chart; 2 px lines; markers ≥ 8 px with 2 px surface ring; bars with 4 px rounded data-ends; grid in `--border`; text in ink/muted tokens, never series colours; every chart has a "Show table" view.
- Light-mode rating colours: Overweight `#6f94d6`, Underweight `#d6923a`, Sell `#9a4a08` (Buy `#1f4fa3`, Hold `#c8c3b6`, dark mode unchanged).
- UI copy: sentence case, no all-caps labels, no `·`-joined metadata strings, no `→` on links/buttons.

## Review Focus

1. A run whose trade date falls on a weekend or holiday → entry uses the last close before it; its dot sits on that bar, not missing. (Task 3 test `entry uses the last close on or before the trade date`.)
2. The price cache is older than the horizon end (stale data) → the verdict stays Open instead of being declared Expired early. (Task 3 test `stays open when bars stop before the horizon end`.)
3. A ticker typed as a custom CLI folder name (e.g. `NVDA q3 earnings`) or a crypto pair (`BTCUSD`) → price refresh skips names that aren't symbols and maps crypto through `normalize_symbol`. (Task 2 test `normalizes symbols and resolves regional benchmarks`; Task 6 route filter.)
4. Benchmark bars end earlier than the ticker's (one fetch failed or lagged) → alpha stays Pending, never computed against a stale benchmark close. (Task 3 test `alpha is pending until the benchmark has the bar too`.)
5. Two runs share the same entry bar → the price chart shows one dot whose tooltip lists both runs; the table lists both. (Task 8 `buildPriceSeries` test.)

---

## File Structure

```
dashboard/worker/
  run_batch.py            (modify: write meta.json)
  prices.py               (new: price cache worker)
  tests/test_prices.py    (new)
  tests/test_run_batch.py (modify)
dashboard/lib/
  outcomes.ts             (new, pure: parseHorizon, scoreVerdict)
  trade-dates.ts          (new: resolveTradeDate, batchTradeDates)
  prices.ts               (new: cache readers)
  scorecard.ts            (new: loadScorecards, loadScorecard, measureStats, summarizeScorecards)
  calendar.ts             (new, pure: month grid, runsByDay, runsPerWeek)
  outcome-text.ts         (new, pure: labels and sentences)
  ticker-series.ts        (new, pure: buildPriceSeries)
  format.ts               (modify: formatPercent, formatRate)
  python.ts               (modify: export lastLine)
  __tests__/{outcomes,trade-dates,prices,scorecard,calendar,outcome-text,ticker-series,prices-route}.test.ts
dashboard/app/
  calendar/page.tsx                     (new)
  insights/page.tsx                     (new)
  tickers/[ticker]/page.tsx, not-found.tsx (new)
  reports/[id]/page.tsx                 (modify: outcome line + link)
  api/prices/refresh/route.ts           (new)
  api/reports/[id]/summary/route.ts     (modify: shared lastLine)
  globals.css                           (modify: light rating colours)
dashboard/components/
  nav.tsx                 (modify: Calendar, Insights)
  price-freshness.tsx     (new)
  month-calendar.tsx      (new)
  charts/use-chart-tokens.ts, chart-frame.tsx, chart-tooltip.tsx (new)
  charts/price-chart.tsx, rating-history-chart.tsx (new)
  charts/hit-rate-chart.tsx, alpha-chart.tsx, runs-per-week-chart.tsx (new)
  runs-table.tsx          (new)
```

---

### Task 1: Batch worker writes `meta.json`

**Files:**
- Modify: `dashboard/worker/run_batch.py`
- Test: `dashboard/worker/tests/test_run_batch.py`

**Interfaces:**
- Produces: `reports/<report_id>/meta.json` = `{"ticker": str, "trade_date": "YYYY-MM-DD", "asset_type": "stock"|"crypto", "analysts": [str], "batch_id": str}` (consumed by Task 4 `resolveTradeDate`).

- [ ] **Step 1: Write the failing test** — append to `dashboard/worker/tests/test_run_batch.py`:

```python
def test_writes_meta_json_with_trade_date(reports):
    write_batch(reports, ["NVDA", "BTCUSD"], auto_summarize=False)
    run_batch.run("20261005_101500_a1b2", graph_factory=FakeGraphs())
    items = saved(reports)["items"]
    nvda = json.loads((reports / items[0]["report_id"] / "meta.json").read_text())
    btc = json.loads((reports / items[1]["report_id"] / "meta.json").read_text())
    assert nvda == {"ticker": "NVDA", "trade_date": "2026-10-03", "asset_type": "stock",
                    "analysts": ["market", "news", "fundamentals"], "batch_id": "20261005_101500_a1b2"}
    assert btc["ticker"] == "BTC-USD" and btc["asset_type"] == "crypto" and btc["analysts"] == ["market", "news"]
```

- [ ] **Step 2: Run it — expect FAIL** (`FileNotFoundError: .../meta.json`)

Run: `.venv/bin/python -m pytest dashboard/worker/tests/test_run_batch.py -q`

- [ ] **Step 3: Implement** — in `dashboard/worker/run_batch.py`:

Change the import line to:

```python
from dashboard.worker.common import load_config, now_iso, reports_dir, write_json_atomic
```

Change `_run_one`'s signature and its last lines:

```python
def _run_one(ticker: str, params: dict, config: dict, graphs: dict, graph_factory, batch_id: str) -> tuple[str, str]:
```

```python
    final_state, rating = graph.propagate(ticker, params["trade_date"], asset_type=asset_type.value)
    report_id = f"{safe_ticker_component(ticker)}_{datetime.now():%Y%m%d_%H%M%S}"
    report_dir = reports_dir() / report_id
    graph.save_reports(final_state, ticker, report_dir)
    # The report folder is named by run time; record what it was an analysis *for*.
    write_json_atomic(report_dir / "meta.json", {
        "ticker": ticker,
        "trade_date": params["trade_date"],
        "asset_type": asset_type.value,
        "analysts": analysts,
        "batch_id": batch_id,
    })
    return report_id, rating
```

And in `run()` pass the id: `report_id, rating = _run_one(item["ticker"], params, config, graphs, graph_factory, batch_id)`.

- [ ] **Step 4: Run tests — expect PASS**

Run: `.venv/bin/python -m pytest dashboard/worker/tests -q` → all pass.

- [ ] **Step 5: Commit**

```bash
git add dashboard/worker && git commit -m "feat(dashboard): record each batch report's trade date in meta.json"
```

---

### Task 2: Price cache worker

**Files:**
- Create: `dashboard/worker/prices.py`
- Test: `dashboard/worker/tests/test_prices.py`

**Interfaces:**
- Consumes: `common.load_config/now_iso/reports_dir/write_json_atomic`; `tradingagents.dataflows.symbol_utils.normalize_symbol`; `TradingAgentsGraph._resolve_benchmark`; `tradingagents.dataflows.utils.safe_ticker_component`.
- Produces: `reports/_prices/<SYMBOL>.json` = `{"symbol", "fetched_at", "bars": [{"date","open","high","low","close"}]}`; `reports/_prices/_index.json` = `{"fetched_at", "tickers": {TICKER: {"symbol","benchmark"}}, "errors": {SYMBOL: msg}}`; CLI `python -m dashboard.worker.prices T1 T2 …` (exit 0 if ≥1 symbol fetched, 1 if none, 2 on usage).

- [ ] **Step 1: Write the failing tests** — `dashboard/worker/tests/test_prices.py`:

```python
import json

import pandas as pd
import pytest

from dashboard.worker import prices

CONFIG = {"benchmark_ticker": None, "benchmark_map": {".T": "^N225", "": "SPY"}}


def fake_fetch(fail=()):
    calls = []

    def fetch(symbol, start):
        calls.append((symbol, start))
        if symbol in fail:
            raise ValueError(f"no price data for {symbol}")
        return [{"date": "2026-10-02", "open": 1.0, "high": 2.0, "low": 0.5, "close": 1.5}]

    fetch.calls = calls
    return fetch


@pytest.fixture
def reports(tmp_path, monkeypatch):
    monkeypatch.setenv("TA_REPORTS_DIR", str(tmp_path))
    return tmp_path


def read(path):
    return json.loads(path.read_text())


def test_normalizes_symbols_and_resolves_regional_benchmarks(reports):
    fetch = fake_fetch()
    result = prices.refresh(["NVDA", "BTCUSD", "7203.T"], fetch=fetch, config=CONFIG, today="2026-10-05")
    index = read(reports / "_prices" / "_index.json")
    assert index["tickers"] == {
        "NVDA": {"symbol": "NVDA", "benchmark": "SPY"},
        "BTCUSD": {"symbol": "BTC-USD", "benchmark": "SPY"},
        "7203.T": {"symbol": "7203.T", "benchmark": "^N225"},
    }
    assert sorted(s for s, _ in fetch.calls) == ["7203.T", "BTC-USD", "NVDA", "SPY", "^N225"]
    assert {start for _, start in fetch.calls} == {"2024-10-05"}
    assert read(reports / "_prices" / "^N225.json")["bars"][0]["close"] == 1.5
    assert result["fetched"] == 5 and result["errors"] == {}


def test_one_failing_symbol_is_recorded_and_others_still_fetch(reports):
    result = prices.refresh(["NVDA", "ZZZZ"], fetch=fake_fetch(fail={"ZZZZ"}), config=CONFIG, today="2026-10-05")
    index = read(reports / "_prices" / "_index.json")
    assert index["errors"] == {"ZZZZ": "ValueError: no price data for ZZZZ"}
    assert (reports / "_prices" / "NVDA.json").exists()
    assert not (reports / "_prices" / "ZZZZ.json").exists()
    assert result["fetched"] == 2


def test_success_clears_old_errors_and_survives_corrupt_index(reports):
    (reports / "_prices").mkdir()
    (reports / "_prices" / "_index.json").write_text("{ half")
    prices.refresh(["NVDA"], fetch=fake_fetch(fail={"NVDA"}), config=CONFIG, today="2026-10-05")
    assert "NVDA" in read(reports / "_prices" / "_index.json")["errors"]
    prices.refresh(["NVDA"], fetch=fake_fetch(), config=CONFIG, today="2026-10-05")
    assert read(reports / "_prices" / "_index.json")["errors"] == {}


def test_fetch_bars_converts_history_and_skips_nan_rows(monkeypatch):
    idx = pd.DatetimeIndex(["2026-10-01", "2026-10-02"], tz="America/New_York")
    df = pd.DataFrame({"Open": [1.0, float("nan")], "High": [2.0, 3.0], "Low": [0.5, 1.0], "Close": [1.5, float("nan")]}, index=idx)

    class FakeTicker:
        def __init__(self, symbol):
            self.symbol = symbol

        def history(self, start, auto_adjust):
            assert auto_adjust is False
            return df

    monkeypatch.setattr(prices.yf, "Ticker", FakeTicker)
    assert prices.fetch_bars("NVDA", "2024-10-05") == [
        {"date": "2026-10-01", "open": 1.0, "high": 2.0, "low": 0.5, "close": 1.5}
    ]
    monkeypatch.setattr(prices.yf, "Ticker", lambda s: type("E", (), {"history": lambda self, **k: pd.DataFrame()})())
    with pytest.raises(ValueError, match="no price data"):
        prices.fetch_bars("ZZZZ", "2024-10-05")


def test_main_exit_codes(reports, monkeypatch, capsys):
    monkeypatch.setattr(prices, "load_config", lambda: CONFIG)
    monkeypatch.setattr(prices, "fetch_bars", fake_fetch(fail={"NVDA", "SPY"}))
    assert prices.main(["NVDA"]) == 1
    assert "NVDA" in capsys.readouterr().err
    monkeypatch.setattr(prices, "fetch_bars", fake_fetch())
    assert prices.main(["NVDA"]) == 0
    assert prices.main([]) == 2
```

- [ ] **Step 2: Run — expect FAIL** (`ImportError: cannot import name 'prices'`)

Run: `.venv/bin/python -m pytest dashboard/worker/tests/test_prices.py -q`

- [ ] **Step 3: Implement** — `dashboard/worker/prices.py`:

```python
"""Daily price cache for the dashboard's charts and verdict scoring.

Usage: python -m dashboard.worker.prices <TICKER> [<TICKER> ...]

Writes reports/_prices/<SYMBOL>.json for every ticker and its benchmark, plus
reports/_prices/_index.json mapping each ticker to its symbol and benchmark.
"""

from __future__ import annotations

import json
import math
import sys
from datetime import date, timedelta
from pathlib import Path
from types import SimpleNamespace

import yfinance as yf

from dashboard.worker.common import load_config, now_iso, reports_dir, write_json_atomic

HISTORY_DAYS = 730


def prices_dir() -> Path:
    return reports_dir() / "_prices"


def fetch_bars(symbol: str, start: str) -> list[dict]:
    df = yf.Ticker(symbol).history(start=start, auto_adjust=False)
    if df is None or df.empty:
        raise ValueError(f"no price data for {symbol}")
    bars = []
    for ts, row in df.iterrows():
        values = [row["Open"], row["High"], row["Low"], row["Close"]]
        if any(v is None or math.isnan(float(v)) for v in values):
            continue
        o, h, l, c = (round(float(v), 4) for v in values)
        bars.append({"date": ts.strftime("%Y-%m-%d"), "open": o, "high": h, "low": l, "close": c})
    if not bars:
        raise ValueError(f"no price data for {symbol}")
    return bars


def resolve_symbols(tickers: list[str], config: dict) -> dict[str, dict]:
    from tradingagents.dataflows.symbol_utils import normalize_symbol
    from tradingagents.graph.trading_graph import TradingAgentsGraph

    # Same symbol and benchmark the framework uses when it scores its own decisions.
    graph_like = SimpleNamespace(config=config)
    return {
        t: {"symbol": normalize_symbol(t), "benchmark": TradingAgentsGraph._resolve_benchmark(graph_like, t)}
        for t in tickers
    }


def _load_index(path: Path) -> dict:
    try:
        index = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(index.get("tickers"), dict) and isinstance(index.get("errors"), dict):
            return index
    except (OSError, ValueError):
        pass
    return {"fetched_at": None, "tickers": {}, "errors": {}}


def refresh(tickers: list[str], *, fetch=None, config: dict | None = None, today: str | None = None) -> dict:
    from tradingagents.dataflows.utils import safe_ticker_component

    fetch = fetch or fetch_bars
    config = config if config is not None else load_config()
    start = (date.fromisoformat(today or date.today().isoformat()) - timedelta(days=HISTORY_DAYS)).isoformat()
    mapping = resolve_symbols(tickers, config)
    symbols = sorted({m["symbol"] for m in mapping.values()} | {m["benchmark"] for m in mapping.values()})

    index_path = prices_dir() / "_index.json"
    index = _load_index(index_path)
    fetched = 0
    for symbol in symbols:
        try:
            name = safe_ticker_component(symbol)
            bars = fetch(symbol, start)
            write_json_atomic(prices_dir() / f"{name}.json", {"symbol": symbol, "fetched_at": now_iso(), "bars": bars})
            index["errors"].pop(symbol, None)
            fetched += 1
        except Exception as exc:  # one bad symbol must not stop the rest
            index["errors"][symbol] = f"{type(exc).__name__}: {exc}"[:300]
    index["tickers"].update(mapping)
    index["fetched_at"] = now_iso()
    write_json_atomic(index_path, index)
    return {"fetched": fetched, "errors": index["errors"]}


def main(argv: list[str] | None = None) -> int:
    args = sys.argv[1:] if argv is None else argv
    if not args:
        print("usage: python -m dashboard.worker.prices <TICKER> [<TICKER> ...]", file=sys.stderr)
        return 2
    result = refresh(args, fetch=fetch_bars)
    for symbol, message in result["errors"].items():
        print(f"{symbol}: {message}", file=sys.stderr)
    return 0 if result["fetched"] else 1


if __name__ == "__main__":
    sys.exit(main())
```

Note: `main` passes `fetch=fetch_bars` explicitly so the test's `monkeypatch.setattr(prices, "fetch_bars", …)` is picked up at call time.

- [ ] **Step 4: Run — expect PASS**

Run: `.venv/bin/python -m pytest dashboard/worker/tests -q` → all pass.

- [ ] **Step 5: Live smoke (network, no LLM)**

Run: `TA_REPORTS_DIR=$(mktemp -d) .venv/bin/python -m dashboard.worker.prices SPY; echo exit=$?`
Expected: `exit=0`, and the temp dir has `_prices/SPY.json` with ~500 bars.

- [ ] **Step 6: Commit**

```bash
git add dashboard/worker && git commit -m "feat(dashboard): add daily price cache worker"
```

---

### Task 3: Scoring rules (`lib/outcomes.ts`)

**Files:**
- Create: `dashboard/lib/outcomes.ts`
- Test: `dashboard/lib/__tests__/outcomes.test.ts`

**Interfaces:**
- Produces:
  - `type Bar = { date: string; high: number; low: number; close: number; open?: number }`
  - `type Verdict = "right" | "wrong" | "pending" | "expired" | "unscored"`
  - `parseHorizon(text: string | null): { amount: number; unit: "day"|"week"|"month"|"year"; assumed: boolean }`
  - `addHorizon(date: string, h): string` (ISO date)
  - `interface LevelsOutcome { verdict: Verdict; touched: "target"|"stop"|"both"|null; date: string|null; horizonEnd: string; horizonAssumed: boolean; note: string|null }`
  - `interface WindowOutcome { days: number; ret: number|null; alpha: number|null; benchmark: Verdict; absolute: Verdict }`
  - `interface Outcome { entry: { date: string; close: number } | null; levels: LevelsOutcome; d5: WindowOutcome; d20: WindowOutcome; note: string|null }`
  - `scoreVerdict(input: { rating: string; tradeDate: string; target: number|null; stop: number|null; horizonText: string|null; bars: Bar[]; benchmarkBars: Bar[] }): Outcome`
  - Constants `HOLD_BAND = 0.02`.

- [ ] **Step 1: Write the failing tests** — `dashboard/lib/__tests__/outcomes.test.ts`:

```ts
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
    const short = rising.slice(0, 10);
    const o = scoreVerdict({ ...base, rating: "Buy", target: 200, stop: 50, bars: short, benchmarkBars: short });
    expect(o.d5.benchmark).toBe("right");
    expect(o.d20).toMatchObject({ ret: null, alpha: null, benchmark: "pending", absolute: "pending" });
  });
  it("alpha is pending until the benchmark has the bar too", () => {
    const o = scoreVerdict({ ...base, rating: "Buy", target: 200, stop: 50, bars: rising, benchmarkBars: index.slice(0, 12) });
    expect(o.d20.ret).toBeCloseTo(0.2);
    expect(o.d20).toMatchObject({ alpha: null, benchmark: "pending", absolute: "right" });
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (`Cannot find package '@/lib/outcomes'`)

Run: `cd dashboard && pnpm exec vitest run lib/__tests__/outcomes.test.ts`

- [ ] **Step 3: Implement** — `dashboard/lib/outcomes.ts`:

```ts
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

const HORIZON_RE = /(\d+)\s*(?:(?:-|–|—|to)\s*(\d+)\s*)?(day|week|month|year)s?/i;

export function parseHorizon(text: string | null): Horizon {
  const m = text ? HORIZON_RE.exec(text) : null;
  if (!m) return DEFAULT_HORIZON;
  return { amount: Number(m[2] ?? m[1]), unit: m[3].toLowerCase() as Unit, assumed: false };
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
  return Math.abs(value) <= HOLD_BAND ? "right" : "wrong";
}

function scoreLevels(input: VerdictInput, entryIdx: number): LevelsOutcome {
  const h = parseHorizon(input.horizonText);
  const horizonEnd = addHorizon(input.tradeDate, h);
  const base = { horizonEnd, horizonAssumed: h.assumed };
  const { target, stop, bars } = input;
  if (target == null || stop == null) return { ...base, verdict: "unscored", touched: null, date: null, note: "no levels" };

  const dir = direction(input.rating);
  const entry = bars[entryIdx].close;
  if (dir === 1 && !(target > entry && stop < entry)) return { ...base, verdict: "unscored", touched: null, date: null, note: "levels don't match the rating" };
  if (dir === -1 && !(target < entry && stop > entry)) return { ...base, verdict: "unscored", touched: null, date: null, note: "levels don't match the rating" };

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

  let alpha: number | null = null;
  const benchEntry = lastIndexOnOrBefore(benchmarkBars, input.tradeDate);
  const benchEnd = lastIndexOnOrBefore(benchmarkBars, bars[i].date);
  if (benchEntry >= 0 && benchEnd > benchEntry && benchmarkBars[benchEnd].date === bars[i].date) {
    alpha = ret - (benchmarkBars[benchEnd].close / benchmarkBars[benchEntry].close - 1);
  }
  return { days, ret, alpha, benchmark: judge(rating, alpha), absolute: judge(rating, ret) };
}

export function scoreVerdict(input: VerdictInput): Outcome {
  const entryIdx = lastIndexOnOrBefore(input.bars, input.tradeDate);
  if (entryIdx < 0) {
    const h = parseHorizon(input.horizonText);
    const none: WindowOutcome = { days: 0, ret: null, alpha: null, benchmark: "unscored", absolute: "unscored" };
    return {
      entry: null,
      levels: { verdict: "unscored", touched: null, date: null, horizonEnd: addHorizon(input.tradeDate, h), horizonAssumed: h.assumed, note: "no price data" },
      d5: { ...none, days: 5 },
      d20: { ...none, days: 20 },
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
```

Spec clarification (ruling, recorded here so execution doesn't re-decide it): a verdict becomes `expired` when the **cached prices** reach the horizon end, not merely when `today` passes it — otherwise a stale cache would mark verdicts expired that might still have been decided. Behaviour is identical with fresh prices.

- [ ] **Step 4: Run — expect PASS**

Run: `cd dashboard && pnpm exec vitest run lib/__tests__/outcomes.test.ts`

- [ ] **Step 5: Commit**

```bash
git add dashboard/lib && git commit -m "feat(dashboard): score verdicts on levels, benchmark and absolute return"
```

---

### Task 4: Trade dates, price cache readers, scorecards

**Files:**
- Create: `dashboard/lib/trade-dates.ts`, `dashboard/lib/prices.ts`, `dashboard/lib/scorecard.ts`
- Modify: `dashboard/lib/format.ts` (add `formatPercent`, `formatRate`)
- Test: `dashboard/lib/__tests__/trade-dates.test.ts`, `prices.test.ts`, `scorecard.test.ts`

**Interfaces:**
- Consumes: `listReports`, `readSummary` (reports.ts), `listBatches` (batches.ts), `reportsDir` (paths.ts), `scoreVerdict`, `Bar`, `Verdict`, `Outcome` (Task 3), `RATINGS`, `Rating`, `ReportListItem`, `ReportSummary` (types.ts).
- Produces:
  - `type TradeDateSource = "meta" | "batch" | "cli-log" | "run-date"`; `interface TradeDate { date: string; source: TradeDateSource }`
  - `resultsDir(): string`; `batchTradeDates(): Promise<Map<string, string>>`; `resolveTradeDate(report: { id: string; ticker: string; runAt: string }, batchMap: Map<string,string>): Promise<TradeDate>`
  - `interface PriceIndex { fetched_at: string | null; tickers: Record<string, { symbol: string; benchmark: string }>; errors: Record<string, string> }`
  - `pricesDir()`, `readPriceIndex(): Promise<PriceIndex>`, `readBars(symbol: string): Promise<Bar[] | null>`, `pricesStale(index: PriceIndex, now?: number): boolean`
  - `interface Scorecard { report: ReportListItem & { summary: ReportSummary }; tradeDate: TradeDate; symbol: string | null; benchmark: string | null; priceError: string | null; outcome: Outcome }`
  - `loadScorecards(): Promise<Scorecard[]>`, `loadScorecard(reportId: string): Promise<Scorecard | null>`
  - `interface MeasureStats { right: number; wrong: number; pending: number; notCounted: number; rate: number | null }`
  - `measureStats(verdicts: Verdict[]): MeasureStats`
  - `interface ScoreSummary { levels: MeasureStats; benchmark: MeasureStats; absolute: MeasureStats; byRating: { rating: Rating; levels: MeasureStats; benchmark: MeasureStats; absolute: MeasureStats; avgAlpha20: number | null; alphaN: number }[] }`
  - `summarizeScorecards(cards: Scorecard[]): ScoreSummary`
  - `formatPercent(n: number | null, opts?: { signed?: boolean; digits?: number }): string` ("+3.1%", "—" for null), `formatRate(n: number | null): string` ("62%", "—").

- [ ] **Step 1: Write the failing tests**

`dashboard/lib/__tests__/trade-dates.test.ts`:

```ts
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { batchTradeDates, resolveTradeDate } from "@/lib/trade-dates";

let reports: string;
let logs: string;
beforeEach(() => {
  reports = mkdtempSync(path.join(os.tmpdir(), "ta-td-reports-"));
  logs = mkdtempSync(path.join(os.tmpdir(), "ta-td-logs-"));
  process.env.TA_REPORTS_DIR = reports;
  process.env.TA_RESULTS_DIR = logs;
});

const report = { id: "SPY_20261004_220413", ticker: "SPY", runAt: "2026-10-04T22:04:13" };

describe("resolveTradeDate", () => {
  it("prefers meta.json", async () => {
    mkdirSync(path.join(reports, report.id));
    writeFileSync(path.join(reports, report.id, "meta.json"), JSON.stringify({ trade_date: "2026-10-02" }));
    expect(await resolveTradeDate(report, new Map([[report.id, "2026-09-30"]]))).toEqual({ date: "2026-10-02", source: "meta" });
  });
  it("then the batch that produced the report", async () => {
    expect(await resolveTradeDate(report, new Map([[report.id, "2026-09-30"]]))).toEqual({ date: "2026-09-30", source: "batch" });
  });
  it("then the CLI log folder closest before the run, within 7 days, ignoring non-date folders", async () => {
    for (const d of ["2026-09-20", "2026-10-03", "2026-10-05", "TradingAgentsStrategy_logs"]) mkdirSync(path.join(logs, "SPY", d), { recursive: true });
    expect(await resolveTradeDate(report, new Map())).toEqual({ date: "2026-10-03", source: "cli-log" });
  });
  it("falls back to the run date", async () => {
    mkdirSync(path.join(logs, "SPY", "2026-09-20"), { recursive: true }); // outside the 7-day window
    expect(await resolveTradeDate(report, new Map())).toEqual({ date: "2026-10-04", source: "run-date" });
  });
});

describe("batchTradeDates", () => {
  it("maps report ids from batch files to their trade date", async () => {
    mkdirSync(path.join(reports, "_batches"));
    writeFileSync(path.join(reports, "_batches", "20261005_151023_6aca.json"), JSON.stringify({
      id: "20261005_151023_6aca", params: { trade_date: "2026-10-05" },
      items: [{ report_id: "SPY_20261005_151903" }, { report_id: null }],
    }));
    expect([...(await batchTradeDates())]).toEqual([["SPY_20261005_151903", "2026-10-05"]]);
  });
});
```

`dashboard/lib/__tests__/prices.test.ts`:

```ts
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { pricesStale, readBars, readPriceIndex } from "@/lib/prices";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "ta-prices-"));
  process.env.TA_REPORTS_DIR = dir;
});

describe("price cache readers", () => {
  it("returns an empty index when missing or corrupt", async () => {
    expect(await readPriceIndex()).toEqual({ fetched_at: null, tickers: {}, errors: {} });
    mkdirSync(path.join(dir, "_prices"));
    writeFileSync(path.join(dir, "_prices", "_index.json"), "{ half");
    expect(await readPriceIndex()).toEqual({ fetched_at: null, tickers: {}, errors: {} });
  });
  it("reads bars by symbol, rejecting unsafe names", async () => {
    mkdirSync(path.join(dir, "_prices"));
    writeFileSync(path.join(dir, "_prices", "^N225.json"), JSON.stringify({ symbol: "^N225", bars: [{ date: "2026-10-02", high: 2, low: 1, close: 1.5 }] }));
    expect(await readBars("^N225")).toEqual([{ date: "2026-10-02", high: 2, low: 1, close: 1.5 }]);
    expect(await readBars("NOPE")).toBeNull();
    expect(await readBars("../x")).toBeNull();
  });
  it("is stale when never fetched or older than 12 hours", () => {
    const now = Date.parse("2026-10-05T12:00:00Z");
    expect(pricesStale({ fetched_at: null, tickers: {}, errors: {} }, now)).toBe(true);
    expect(pricesStale({ fetched_at: "2026-10-05T01:00:00Z", tickers: {}, errors: {} }, now)).toBe(false);
    expect(pricesStale({ fetched_at: "2026-10-04T23:00:00Z", tickers: {}, errors: {} }, now)).toBe(true);
  });
});
```

`dashboard/lib/__tests__/scorecard.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { Outcome, Verdict } from "@/lib/outcomes";
import { measureStats, summarizeScorecards, type Scorecard } from "@/lib/scorecard";
import type { ReportSummary } from "@/lib/types";
import { formatPercent, formatRate } from "@/lib/format";

describe("measureStats", () => {
  it("counts right/wrong/pending/not counted and computes the rate over settled ones", () => {
    const v: Verdict[] = ["right", "right", "wrong", "pending", "expired", "unscored"];
    expect(measureStats(v)).toEqual({ right: 2, wrong: 1, pending: 1, notCounted: 2, rate: 2 / 3 });
  });
  it("has no rate with nothing settled", () => {
    expect(measureStats(["pending", "expired"]).rate).toBeNull();
  });
});

const card = (rating: string, levels: Verdict, bench: Verdict, abs: Verdict, alpha: number | null): Scorecard => ({
  report: { id: rating + Math.random(), ticker: "X", runAt: "2026-10-01T00:00:00", summaryStale: false, summary: { rating } as ReportSummary },
  tradeDate: { date: "2026-10-01", source: "batch" },
  symbol: "X", benchmark: "SPY", priceError: null,
  outcome: {
    entry: { date: "2026-10-01", close: 1 },
    levels: { verdict: levels, touched: null, date: null, horizonEnd: "2027-01-01", horizonAssumed: false, note: null },
    d5: { days: 5, ret: null, alpha: null, benchmark: "pending", absolute: "pending" },
    d20: { days: 20, ret: alpha, alpha, benchmark: bench, absolute: abs },
    note: null,
  } as Outcome,
});

describe("summarizeScorecards", () => {
  it("summarizes overall and by rating, averaging settled 20-day alpha", () => {
    const s = summarizeScorecards([
      card("Buy", "right", "right", "right", 0.04),
      card("Buy", "wrong", "wrong", "right", -0.02),
      card("Hold", "unscored", "right", "right", 0.01),
      card("Sell", "pending", "pending", "pending", null),
    ]);
    expect(s.levels).toMatchObject({ right: 1, wrong: 1, pending: 1, notCounted: 1, rate: 0.5 });
    const buy = s.byRating.find((r) => r.rating === "Buy")!;
    expect(buy.avgAlpha20).toBeCloseTo(0.01);
    expect(buy.alphaN).toBe(2);
    expect(s.byRating.map((r) => r.rating)).toEqual(["Buy", "Overweight", "Hold", "Underweight", "Sell"]);
    expect(s.byRating.find((r) => r.rating === "Sell")!.avgAlpha20).toBeNull();
  });
});

describe("formatPercent / formatRate", () => {
  it("formats", () => {
    expect(formatPercent(0.0312, { signed: true })).toBe("+3.1%");
    expect(formatPercent(-0.02, { signed: true })).toBe("−2.0%");
    expect(formatPercent(null)).toBe("—");
    expect(formatRate(2 / 3)).toBe("67%");
    expect(formatRate(null)).toBe("—");
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (missing modules / exports)

Run: `cd dashboard && pnpm test`

- [ ] **Step 3: Implement**

Append to `dashboard/lib/format.ts`:

```ts
/** 0.0312 → "3.1%" (or "+3.1%" when signed). Uses a true minus sign. */
export function formatPercent(n: number | null | undefined, opts: { signed?: boolean; digits?: number } = {}): string {
  if (n == null) return "—";
  const text = Math.abs(n * 100).toFixed(opts.digits ?? 1) + "%";
  if (n < 0) return "−" + text;
  return opts.signed && n > 0 ? "+" + text : text;
}

/** Hit rate 0–1 → "67%". */
export function formatRate(n: number | null | undefined): string {
  return n == null ? "—" : `${Math.round(n * 100)}%`;
}
```

`dashboard/lib/trade-dates.ts`:

```ts
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { listBatches } from "@/lib/batches";
import { reportsDir } from "@/lib/paths";

export type TradeDateSource = "meta" | "batch" | "cli-log" | "run-date";
export interface TradeDate {
  date: string;
  source: TradeDateSource;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const CLI_LOG_WINDOW_DAYS = 7;

/** Where the CLI writes per-run logs: <results_dir>/<TICKER>/<trade date>/. */
export function resultsDir(): string {
  return process.env.TA_RESULTS_DIR ?? path.join(os.homedir(), ".tradingagents", "logs");
}

export async function batchTradeDates(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (const batch of await listBatches()) {
    for (const item of batch.items ?? []) {
      if (item.report_id && DATE_RE.test(batch.params?.trade_date ?? "")) map.set(item.report_id, batch.params.trade_date);
    }
  }
  return map;
}

function minusDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

export async function resolveTradeDate(
  report: { id: string; ticker: string; runAt: string },
  batchMap: Map<string, string>,
): Promise<TradeDate> {
  try {
    const meta = JSON.parse(await fs.readFile(path.join(reportsDir(), report.id, "meta.json"), "utf-8"));
    if (DATE_RE.test(meta?.trade_date ?? "")) return { date: meta.trade_date, source: "meta" };
  } catch {
    // no meta.json (older report) — fall through
  }

  const fromBatch = batchMap.get(report.id);
  if (fromBatch) return { date: fromBatch, source: "batch" };

  const runDate = report.runAt.slice(0, 10);
  try {
    const earliest = minusDays(runDate, CLI_LOG_WINDOW_DAYS);
    const dates = (await fs.readdir(path.join(resultsDir(), report.ticker)))
      .filter((d) => DATE_RE.test(d) && d <= runDate && d >= earliest)
      .sort();
    if (dates.length) return { date: dates[dates.length - 1], source: "cli-log" };
  } catch {
    // no CLI logs for this ticker
  }
  return { date: runDate, source: "run-date" };
}
```

`dashboard/lib/prices.ts`:

```ts
import fs from "node:fs/promises";
import path from "node:path";
import type { Bar } from "@/lib/outcomes";
import { reportsDir } from "@/lib/paths";

export interface PriceIndex {
  fetched_at: string | null;
  tickers: Record<string, { symbol: string; benchmark: string }>;
  errors: Record<string, string>;
}

const STALE_MS = 12 * 60 * 60 * 1000;
const SYMBOL_RE = /^[A-Za-z0-9._\-^=+]+$/;
const EMPTY: PriceIndex = { fetched_at: null, tickers: {}, errors: {} };

export function pricesDir(): string {
  return path.join(reportsDir(), "_prices");
}

export async function readPriceIndex(): Promise<PriceIndex> {
  try {
    const data = JSON.parse(await fs.readFile(path.join(pricesDir(), "_index.json"), "utf-8"));
    if (data && typeof data.tickers === "object" && typeof data.errors === "object") {
      return { fetched_at: data.fetched_at ?? null, tickers: data.tickers, errors: data.errors };
    }
  } catch {
    // missing or half-written index
  }
  return { ...EMPTY, tickers: {}, errors: {} };
}

export async function readBars(symbol: string): Promise<Bar[] | null> {
  if (!SYMBOL_RE.test(symbol) || /^\.+$/.test(symbol)) return null;
  try {
    const data = JSON.parse(await fs.readFile(path.join(pricesDir(), `${symbol}.json`), "utf-8"));
    return Array.isArray(data?.bars) ? (data.bars as Bar[]) : null;
  } catch {
    return null;
  }
}

export function pricesStale(index: PriceIndex, now: number = Date.now()): boolean {
  return !index.fetched_at || now - Date.parse(index.fetched_at) > STALE_MS;
}
```

`dashboard/lib/scorecard.ts`:

```ts
import { scoreVerdict, type Bar, type Outcome, type Verdict } from "@/lib/outcomes";
import { readBars, readPriceIndex, type PriceIndex } from "@/lib/prices";
import { listReports } from "@/lib/reports";
import { batchTradeDates, resolveTradeDate, type TradeDate } from "@/lib/trade-dates";
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
  const barCache = new Map<string, Promise<Bar[] | null>>();
  const bars = (symbol: string) => {
    if (!barCache.has(symbol)) barCache.set(symbol, readBars(symbol));
    return barCache.get(symbol)!;
  };

  return Promise.all(
    reports.map(async (report) => {
      const tradeDate = await resolveTradeDate(report, batchMap);
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

export async function loadScorecards(): Promise<Scorecard[]> {
  return buildCards((await listReports()).filter(isRated), await readPriceIndex());
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
```

- [ ] **Step 4: Run — expect PASS**

Run: `cd dashboard && pnpm test` → all pass; `pnpm exec tsc --noEmit` clean.

- [ ] **Step 5: Commit**

```bash
git add dashboard/lib && git commit -m "feat(dashboard): resolve trade dates, read price cache and build scorecards"
```

---

### Task 5: Calendar

**Files:**
- Create: `dashboard/lib/calendar.ts`, `dashboard/components/month-calendar.tsx`, `dashboard/app/calendar/page.tsx`
- Test: `dashboard/lib/__tests__/calendar.test.ts`

**Interfaces:**
- Consumes: `listReports`, `RATING_SWATCH` (rating-tag.tsx), `RatingTag`, `formatWhen`, `todayLocal`.
- Produces:
  - `interface CalendarDay { date: string; day: number; inMonth: boolean }`
  - `parseMonth(s?: string): string | null`, `shiftMonth(month: string, delta: number): string`, `monthLabel(month: string): string` ("October 2026"), `monthGrid(month: string): CalendarDay[][]`, `runsByDay<T extends { runAt: string }>(items: T[]): Map<string, T[]>`, `weekStart(date: string): string`, `runsPerWeek(runDates: string[], weeks: number, today: string): { week: string; count: number }[]` (oldest first; used by Task 9).

- [ ] **Step 1: Write the failing tests** — `dashboard/lib/__tests__/calendar.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { monthGrid, monthLabel, parseMonth, runsByDay, runsPerWeek, shiftMonth, weekStart } from "@/lib/calendar";

describe("month helpers", () => {
  it("parses, shifts and labels months", () => {
    expect(parseMonth("2026-10")).toBe("2026-10");
    expect(parseMonth("2026-13")).toBeNull();
    expect(parseMonth(undefined)).toBeNull();
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(monthLabel("2026-10")).toBe("October 2026");
  });
});

describe("monthGrid", () => {
  it("builds Monday-first weeks covering the month", () => {
    const g = monthGrid("2026-10"); // 1 Oct 2026 is a Thursday
    expect(g[0].map((d) => d.date)).toEqual(["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"]);
    expect(g[0][2].inMonth).toBe(false);
    expect(g[0][3]).toEqual({ date: "2026-10-01", day: 1, inMonth: true });
    expect(g.at(-1)!.at(-1)!.date).toBe("2026-11-01");
    expect(g).toHaveLength(5);
  });
  it("crosses the year boundary", () => {
    expect(monthGrid("2027-01")[0][0].date).toBe("2026-12-28");
  });
});

describe("runsByDay / weeks", () => {
  it("groups runs by their local run date", () => {
    const m = runsByDay([{ runAt: "2026-10-04T22:04:13" }, { runAt: "2026-10-04T21:34:24" }, { runAt: "2026-10-05T09:13:24" }]);
    expect(m.get("2026-10-04")).toHaveLength(2);
    expect(m.get("2026-10-05")).toHaveLength(1);
  });
  it("counts runs per Monday-starting week, oldest first, including empty weeks", () => {
    expect(weekStart("2026-10-04")).toBe("2026-09-28");
    expect(runsPerWeek(["2026-10-04", "2026-10-05", "2026-10-05", "2026-09-17"], 3, "2026-10-05")).toEqual([
      { week: "2026-09-21", count: 0 },
      { week: "2026-09-28", count: 1 },
      { week: "2026-10-05", count: 2 },
    ]);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `cd dashboard && pnpm exec vitest run lib/__tests__/calendar.test.ts`

- [ ] **Step 3: Implement**

`dashboard/lib/calendar.ts`:

```ts
// Pure calendar helpers. Dates are local wall-clock "YYYY-MM-DD"; arithmetic in UTC to avoid DST shifts.

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export interface CalendarDay {
  date: string;
  day: number;
  inMonth: boolean;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const utc = (date: string) => new Date(`${date}T00:00:00Z`);

export function parseMonth(s?: string): string | null {
  if (!s || !/^\d{4}-\d{2}$/.test(s)) return null;
  const m = Number(s.slice(5));
  return m >= 1 && m <= 12 ? s : null;
}

export function shiftMonth(month: string, delta: number): string {
  const d = utc(`${month}-01`);
  d.setUTCMonth(d.getUTCMonth() + delta);
  return iso(d).slice(0, 7);
}

export function monthLabel(month: string): string {
  return `${MONTH_NAMES[Number(month.slice(5)) - 1]} ${month.slice(0, 4)}`;
}

export function weekStart(date: string): string {
  const d = utc(date);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); // back to Monday
  return iso(d);
}

export function monthGrid(month: string): CalendarDay[][] {
  const first = `${month}-01`;
  const next = `${shiftMonth(month, 1)}-01`;
  const cursor = utc(weekStart(first));
  const weeks: CalendarDay[][] = [];
  while (iso(cursor) < next) {
    const week: CalendarDay[] = [];
    for (let i = 0; i < 7; i++) {
      const date = iso(cursor);
      week.push({ date, day: cursor.getUTCDate(), inMonth: date.startsWith(month) });
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    weeks.push(week);
  }
  return weeks;
}

export function runsByDay<T extends { runAt: string }>(items: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const day = item.runAt.slice(0, 10);
    map.set(day, [...(map.get(day) ?? []), item]);
  }
  return map;
}

export function runsPerWeek(runDates: string[], weeks: number, today: string): { week: string; count: number }[] {
  const last = utc(weekStart(today));
  const out: { week: string; count: number }[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const d = new Date(last);
    d.setUTCDate(d.getUTCDate() - 7 * i);
    out.push({ week: iso(d), count: 0 });
  }
  const index = new Map(out.map((w, i) => [w.week, i]));
  for (const date of runDates) {
    const i = index.get(weekStart(date));
    if (i !== undefined) out[i].count++;
  }
  return out;
}
```

`dashboard/components/month-calendar.tsx`:

```tsx
import Link from "next/link";
import { RATING_SWATCH } from "@/components/rating-tag";
import type { CalendarDay } from "@/lib/calendar";
import { cn } from "@/lib/utils";
import type { ReportListItem } from "@/lib/types";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MAX_TICKERS = 3;

function Swatch({ rating }: { rating: string | undefined }) {
  return (
    <span
      aria-hidden
      className={cn("inline-block size-2 shrink-0 rounded-[2px]", rating && RATING_SWATCH[rating] ? RATING_SWATCH[rating] : "border border-muted-foreground")}
    />
  );
}

export function MonthCalendar({
  weeks, runs, month, selected, today,
}: {
  weeks: CalendarDay[][];
  runs: Map<string, ReportListItem[]>;
  month: string;
  selected: string | null;
  today: string;
}) {
  return (
    <table className="w-full table-fixed border-collapse">
      <thead>
        <tr>
          {WEEKDAYS.map((d) => (
            <th key={d} scope="col" className="pb-2 text-left text-sm font-normal text-muted-foreground">{d}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {weeks.map((week) => (
          <tr key={week[0].date}>
            {week.map((day) => {
              const dayRuns = runs.get(day.date) ?? [];
              const label = `${day.day}${dayRuns.length ? `, ${dayRuns.length} run${dayRuns.length > 1 ? "s" : ""}` : ""}`;
              return (
                <td key={day.date} className="h-24 border border-border p-0 align-top sm:h-28">
                  <Link
                    href={`/calendar?month=${month}&day=${day.date}`}
                    aria-label={label}
                    aria-current={selected === day.date ? "date" : undefined}
                    className={cn(
                      "flex h-full flex-col gap-1 p-1.5 hover:bg-card sm:p-2",
                      !day.inMonth && "text-muted-foreground/60",
                      selected === day.date && "bg-card",
                    )}
                  >
                    <span className={cn("text-sm", day.date === today && "self-start rounded-full px-1.5 outline-2 outline-foreground")}>{day.day}</span>
                    {/* Wide screens: tickers with swatches. Phones: swatches and a count. */}
                    <span className="hidden flex-col gap-0.5 sm:flex">
                      {dayRuns.slice(0, MAX_TICKERS).map((r) => (
                        <span key={r.id} className="flex items-center gap-1.5 truncate text-sm font-semibold tracking-[-0.01em]">
                          <Swatch rating={r.summary?.rating} />
                          {r.ticker}
                        </span>
                      ))}
                      {dayRuns.length > MAX_TICKERS && <span className="text-xs text-muted-foreground">+{dayRuns.length - MAX_TICKERS} more</span>}
                    </span>
                    {dayRuns.length > 0 && (
                      <span className="flex flex-wrap items-center gap-1 sm:hidden">
                        {dayRuns.slice(0, 2).map((r) => <Swatch key={r.id} rating={r.summary?.rating} />)}
                        {dayRuns.length > 2 && <span className="text-xs">+{dayRuns.length - 2}</span>}
                      </span>
                    )}
                  </Link>
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

`dashboard/app/calendar/page.tsx`:

```tsx
import Link from "next/link";
import { MonthCalendar } from "@/components/month-calendar";
import { RatingTag } from "@/components/rating-tag";
import { monthGrid, monthLabel, parseMonth, runsByDay, shiftMonth } from "@/lib/calendar";
import { formatWhen, todayLocal } from "@/lib/format";
import { listReports } from "@/lib/reports";

export const dynamic = "force-dynamic";

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ month?: string; day?: string }> }) {
  const sp = await searchParams;
  const reports = await listReports();
  const today = todayLocal();
  const month = parseMonth(sp.month) ?? (reports[0]?.runAt.slice(0, 7) ?? today.slice(0, 7));
  const day = sp.day && /^\d{4}-\d{2}-\d{2}$/.test(sp.day) ? sp.day : null;
  const runs = runsByDay(reports);
  const dayRuns = day ? runs.get(day) ?? [] : [];

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold tracking-[-0.03em]">{monthLabel(month)}</h1>
          <p className="text-muted-foreground">Reports by the day they ran.</p>
        </div>
        <nav aria-label="Month" className="flex gap-4 text-sm">
          <Link href={`/calendar?month=${shiftMonth(month, -1)}`} className="underline-offset-4 hover:underline">Previous month</Link>
          <Link href={`/calendar?month=${shiftMonth(month, 1)}`} className="underline-offset-4 hover:underline">Next month</Link>
        </nav>
      </div>
      <MonthCalendar weeks={monthGrid(month)} runs={runs} month={month} selected={day} today={today} />
      {day && (
        <section className="space-y-3">
          <h2 className="text-xl font-bold tracking-[-0.02em]">{formatWhen(`${day}T00:00`).replace(", 00:00", "")}</h2>
          {dayRuns.length === 0 ? (
            <p className="text-muted-foreground">No reports ran on this day.</p>
          ) : (
            <ul>
              {dayRuns.map((r) => (
                <li key={r.id} className="flex flex-wrap items-baseline gap-x-5 border-t border-border py-3">
                  <Link href={`/reports/${encodeURIComponent(r.id)}`} className="text-lg font-bold tracking-[-0.02em] underline-offset-4 hover:underline">{r.ticker}</Link>
                  <span className="text-muted-foreground">{formatWhen(r.runAt).split(", ")[1]}</span>
                  <RatingTag rating={r.summary?.rating} />
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run tests + build**

Run: `cd dashboard && pnpm test && pnpm exec tsc --noEmit && pnpm lint`

- [ ] **Step 5: Commit**

```bash
git add dashboard && git commit -m "feat(dashboard): add a runs calendar"
```

---

### Task 6: Price refresh API, freshness control, nav

**Files:**
- Create: `dashboard/app/api/prices/refresh/route.ts`, `dashboard/components/price-freshness.tsx`
- Modify: `dashboard/lib/python.ts` (export `lastLine`), `dashboard/app/api/reports/[id]/summary/route.ts` (use it), `dashboard/components/nav.tsx`
- Test: `dashboard/lib/__tests__/prices-route.test.ts`

**Interfaces:**
- Consumes: `localRequestError`, `runWorker`, `listReports`, `readPriceIndex`, `formatIsoWhen`.
- Produces: `POST /api/prices/refresh` → 200 `{fetched_at, errors}` | 403 | 409 `{error}` | 500 `{error, errors?}`; `lastLine(text: string): string`; `<PriceFreshness fetchedAt={string|null} stale={boolean} errors={Record<string,string>} />`.

- [ ] **Step 1: Write the failing test** — `dashboard/lib/__tests__/prices-route.test.ts`:

```ts
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { POST } from "@/app/api/prices/refresh/route";

let dir: string;
const local = () => new Request("http://localhost:3000/api/prices/refresh", { method: "POST", headers: { host: "localhost:3000" } });

/** A stand-in for python: records its args, writes an index, optionally sleeps / fails. */
function fakePython(body: string) {
  const script = path.join(dir, "fake-python.sh");
  writeFileSync(script, `#!/bin/sh\necho "$@" > "$TA_REPORTS_DIR/args.txt"\n${body}\n`);
  chmodSync(script, 0o755);
  process.env.TA_PYTHON = script;
}

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "ta-prices-route-"));
  process.env.TA_REPORTS_DIR = dir;
  for (const id of ["SPY_20261004_220413", "BTCUSD_20261004_220413", "NVDA q3 earnings"]) mkdirSync(path.join(dir, id));
});

describe("POST /api/prices/refresh", () => {
  it("runs the worker for every reported ticker that is a valid symbol", async () => {
    fakePython(`mkdir -p "$TA_REPORTS_DIR/_prices"; echo '{"fetched_at":"2026-10-05T08:00:00Z","tickers":{},"errors":{}}' > "$TA_REPORTS_DIR/_prices/_index.json"`);
    const res = await POST(local());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ fetched_at: "2026-10-05T08:00:00Z", errors: {} });
    const { readFileSync } = await import("node:fs");
    expect(readFileSync(path.join(dir, "args.txt"), "utf-8").trim()).toBe("-m dashboard.worker.prices BTCUSD SPY");
  });

  it("reports the worker's last error line", async () => {
    fakePython(`echo "ZZZZ: ValueError: no price data" >&2; exit 1`);
    const res = await POST(local());
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("ZZZZ: ValueError: no price data");
  });

  it("refuses a second refresh while one is running, and cross-site requests", async () => {
    fakePython("sleep 1");
    const first = POST(local());
    const second = await POST(local());
    expect(second.status).toBe(409);
    expect((await first).status).toBe(200);
    const cross = new Request("http://localhost:3000/api/prices/refresh", { method: "POST", headers: { host: "localhost:3000", "sec-fetch-site": "cross-site" } });
    expect((await POST(cross)).status).toBe(403);
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (route module missing)

Run: `cd dashboard && pnpm exec vitest run lib/__tests__/prices-route.test.ts`

- [ ] **Step 3: Implement**

In `dashboard/lib/python.ts` append:

```ts
/** Last non-empty line of a worker's stderr — its one-line error message. */
export function lastLine(text: string): string {
  return text.trim().split("\n").pop() ?? "";
}
```

In `dashboard/app/api/reports/[id]/summary/route.ts`: delete the local `const lastLine = …` and import it: `import { lastLine, runWorker } from "@/lib/python";`.

`dashboard/app/api/prices/refresh/route.ts`:

```ts
import { NextResponse } from "next/server";
import { localRequestError } from "@/lib/guard";
import { readPriceIndex } from "@/lib/prices";
import { lastLine, runWorker } from "@/lib/python";
import { listReports } from "@/lib/reports";

// Folder names that aren't market symbols (custom CLI save paths) are skipped.
const SYMBOL_RE = /^[A-Za-z0-9.\-^=+]{1,32}$/;
let running = false; // one refresh at a time per server process

export async function POST(req: Request) {
  const denied = localRequestError(req);
  if (denied) return NextResponse.json({ error: denied }, { status: 403 });
  if (running) return NextResponse.json({ error: "Prices are already refreshing." }, { status: 409 });

  running = true;
  try {
    const tickers = [...new Set((await listReports()).map((r) => r.ticker))].filter((t) => SYMBOL_RE.test(t)).sort();
    if (!tickers.length) return NextResponse.json({ fetched_at: null, errors: {} });
    let result;
    try {
      result = await runWorker("dashboard.worker.prices", tickers, 120_000);
    } catch (e) {
      return NextResponse.json({ error: `Could not start the Python worker: ${(e as Error).message}` }, { status: 500 });
    }
    const index = await readPriceIndex();
    if (result.code !== 0) {
      return NextResponse.json({ error: lastLine(result.stderr) || `Price worker exited with code ${result.code}`, errors: index.errors }, { status: 500 });
    }
    return NextResponse.json({ fetched_at: index.fetched_at, errors: index.errors });
  } finally {
    running = false;
  }
}
```

`dashboard/components/price-freshness.tsx`:

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { formatIsoWhen } from "@/lib/format";

/** Shows when prices were fetched; refreshes once automatically when the cache is stale. */
export function PriceFreshness({ fetchedAt, stale, errors }: { fetchedAt: string | null; stale: boolean; errors: Record<string, string> }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const autoStarted = useRef(false);

  async function refresh() {
    setBusy(true);
    setMessage(null);
    const res = await fetch("/api/prices/refresh", { method: "POST" }).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : {};
    setBusy(false);
    if (res?.ok) router.refresh();
    else setMessage(res?.status === 409 ? "Already refreshing." : (data.error ?? "Couldn’t reach the dashboard server."));
  }

  useEffect(() => {
    if (stale && !autoStarted.current) {
      autoStarted.current = true;
      void refresh();
    }
    // Runs once per mount; refresh() is stable enough for this purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stale]);

  const failed = Object.keys(errors);
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
      <span aria-live="polite">
        {busy ? "Updating prices…" : fetchedAt ? `Prices updated ${formatIsoWhen(fetchedAt)}` : "No prices fetched yet"}
      </span>
      <Button size="sm" variant="outline" onClick={refresh} disabled={busy}>Refresh prices</Button>
      {message && <span className="text-destructive">{message}</span>}
      {failed.length > 0 && !message && <span>No prices for {failed.join(", ")}.</span>}
    </div>
  );
}
```

If `pnpm lint` flags `react-hooks/set-state-in-effect` for the effect, ledger a ruling and keep the eslint-disable on that line too; the effect deliberately starts an async refresh once.

In `dashboard/components/nav.tsx` replace `LINKS` and the `current` helper:

```tsx
const LINKS = [
  { href: "/", label: "Verdicts" },
  { href: "/calendar", label: "Calendar" },
  { href: "/insights", label: "Insights" },
  { href: "/batches", label: "Batches" },
  { href: "/batches/new", label: "New batch" },
];
```

```tsx
  const current = (href: string) => {
    if (href === "/") return pathname === "/" || pathname.startsWith("/reports") || pathname.startsWith("/tickers");
    if (href === "/batches") return /^\/batches(\/(?!new)|$)/.test(pathname);
    return pathname === href;
  };
```

- [ ] **Step 4: Run — expect PASS**

Run: `cd dashboard && pnpm test && pnpm exec tsc --noEmit && pnpm lint`

- [ ] **Step 5: Commit**

```bash
git add dashboard && git commit -m "feat(dashboard): add price refresh endpoint, freshness control and nav entries"
```

---

### Task 7: Chart foundation and palette update

**Files:**
- Modify: `dashboard/package.json` (deps), `dashboard/app/globals.css` (light rating colours)
- Create: `dashboard/components/charts/use-chart-tokens.ts`, `chart-frame.tsx`, `chart-tooltip.tsx`

**Interfaces:**
- Produces: `useChartTokens(): ChartTokens | null` with `ChartTokens = { ink: string; muted: string; border: string; surface: string; rating: Record<string, string> }`; `<ChartFrame title description? table>{chart}</ChartFrame>`; `<ChartTooltipBox>{children}</ChartTooltipBox>`; `AXIS_TICK` style helper `axisTick(t: ChartTokens)`.

- [ ] **Step 1: Install**

Run: `cd dashboard && pnpm add recharts react-is`

- [ ] **Step 2: Update light-mode rating colours** — in `dashboard/app/globals.css` `:root` block (light):

```css
  --rating-overweight: #6f94d6;
  --rating-overweight-ink: #ffffff;
  --rating-underweight: #d6923a;
  --rating-sell: #9a4a08;
```

(`--rating-underweight-ink` stays `#14233b` and `--rating-sell-ink` stays `#ffffff`. The `-ink` tokens are text-on-swatch colours, unused by components today but kept correct.)

- [ ] **Step 3: Validate the palette (must pass)**

```bash
V=/tmp/claude-1000/bundled-skills/2.1.289/76c9711eb0aece68aa4a4fd431f4df36/dataviz/scripts/validate_palette.js
node $V "#6f94d6,#1f4fa3" --ordinal --mode light --surface "#eef2ea"
node $V "#d6923a,#9a4a08" --ordinal --mode light --surface "#eef2ea"
```

Expected: `ALL CHECKS PASS` for both. (If the skill path differs, locate `validate_palette.js` under the dataviz skill directory.)

- [ ] **Step 4: Chart primitives**

`dashboard/components/charts/use-chart-tokens.ts`:

```ts
"use client";

import { useSyncExternalStore } from "react";

export interface ChartTokens {
  ink: string;
  muted: string;
  border: string;
  surface: string;
  rating: Record<string, string>;
}

const QUERY = "(prefers-color-scheme: dark)";
let cache: { dark: boolean; tokens: ChartTokens } | null = null;

function read(): ChartTokens {
  const s = getComputedStyle(document.documentElement);
  const v = (name: string) => s.getPropertyValue(name).trim();
  return {
    ink: v("--foreground"),
    muted: v("--muted-foreground"),
    border: v("--border"),
    surface: v("--background"),
    rating: {
      Buy: v("--rating-buy"),
      Overweight: v("--rating-overweight"),
      Hold: v("--rating-hold"),
      Underweight: v("--rating-underweight"),
      Sell: v("--rating-sell"),
    },
  };
}

function subscribe(onChange: () => void) {
  const mq = window.matchMedia(QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

function getSnapshot(): ChartTokens {
  const dark = window.matchMedia(QUERY).matches;
  if (!cache || cache.dark !== dark) cache = { dark, tokens: read() };
  return cache.tokens;
}

/** Theme colours for SVG charts, following the system light/dark setting. Null during SSR. */
export function useChartTokens(): ChartTokens | null {
  return useSyncExternalStore(subscribe, getSnapshot, () => null);
}

export const axisTick = (t: ChartTokens) => ({ fill: t.muted, fontSize: 12 });
```

`dashboard/components/charts/chart-frame.tsx`:

```tsx
import type { ReactNode } from "react";

/** A titled chart with a disclosure that shows the same data as a table. */
export function ChartFrame({ title, description, table, children }: { title: string; description?: string; table: ReactNode; children: ReactNode }) {
  return (
    <figure className="space-y-3">
      <figcaption className="space-y-1">
        <h3 className="font-semibold">{title}</h3>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </figcaption>
      {children}
      <details>
        <summary className="cursor-pointer text-sm text-muted-foreground hover:text-foreground">Show table</summary>
        <div className="mt-3 overflow-x-auto">{table}</div>
      </details>
    </figure>
  );
}

export const tableClasses = {
  table: "w-full border-collapse text-sm",
  th: "py-2 pr-4 text-left font-normal text-muted-foreground",
  td: "border-t border-border py-2 pr-4",
};
```

`dashboard/components/charts/chart-tooltip.tsx`:

```tsx
import type { ReactNode } from "react";

export function ChartTooltipBox({ children }: { children: ReactNode }) {
  return <div className="rounded-[3px] border border-border bg-card px-3 py-2 text-sm text-foreground shadow-sm">{children}</div>;
}
```

- [ ] **Step 5: Verify**

Run: `cd dashboard && pnpm exec tsc --noEmit && pnpm lint && pnpm test`

- [ ] **Step 6: Commit**

```bash
git add dashboard && git commit -m "feat(dashboard): add chart primitives and validated light rating colours"
```

---

### Task 8: Ticker page — price and rating-history charts, runs table

**Files:**
- Create: `dashboard/lib/ticker-series.ts`, `dashboard/lib/outcome-text.ts`, `dashboard/components/charts/price-chart.tsx`, `dashboard/components/charts/rating-history-chart.tsx`, `dashboard/components/runs-table.tsx`, `dashboard/app/tickers/[ticker]/page.tsx`, `dashboard/app/tickers/[ticker]/not-found.tsx`
- Test: `dashboard/lib/__tests__/ticker-series.test.ts`, `dashboard/lib/__tests__/outcome-text.test.ts`

**Interfaces:**
- Consumes: `Scorecard`, `loadScorecards`, `readPriceIndex`, `readBars`, `pricesStale`, `Bar`, `Verdict`, `LevelsOutcome`, `RATINGS`, chart primitives, `PriceFreshness`, `RatingScaleMarker`, `RatingTag`, format helpers.
- Produces:
  - `interface SeriesRun { reportId: string; rating: string; runAt: string }`
  - `interface PricePoint { date: string; close: number; runs: SeriesRun[]; ratingStep: number | null }` (`ratingStep`: 4 = Buy … 0 = Sell, carried forward from the latest run on or before the date)
  - `buildPriceSeries(bars: Bar[], cards: { report: { id: string; runAt: string; summary: { rating: string } }; outcome: { entry: { date: string } | null } }[], leadBars?: number): PricePoint[]`
  - `verdictLabel(v: Verdict): string` (Right/Wrong/Open/Expired/Not scored), `levelsSentence(l: LevelsOutcome): string`, `benchmarkSentence(card: Scorecard): string`.

- [ ] **Step 1: Write the failing tests**

`dashboard/lib/__tests__/ticker-series.test.ts`:

```ts
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
```

`dashboard/lib/__tests__/outcome-text.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { levelsSentence, verdictLabel } from "@/lib/outcome-text";
import type { LevelsOutcome } from "@/lib/outcomes";

const l = (o: Partial<LevelsOutcome>): LevelsOutcome => ({ verdict: "pending", touched: null, date: null, horizonEnd: "2027-01-04", horizonAssumed: false, note: null, ...o });

describe("outcome text", () => {
  it("labels verdicts", () => {
    expect(["right", "wrong", "pending", "expired", "unscored"].map((v) => verdictLabel(v as never))).toEqual(["Right", "Wrong", "Open", "Expired", "Not scored"]);
  });
  it("describes level outcomes in plain words", () => {
    expect(levelsSentence(l({ verdict: "right", touched: "target", date: "2026-10-12" }))).toBe("Target hit on 12 Oct 2026");
    expect(levelsSentence(l({ verdict: "wrong", touched: "stop", date: "2026-10-12" }))).toBe("Stop hit on 12 Oct 2026");
    expect(levelsSentence(l({ verdict: "wrong", touched: "both", date: "2026-10-12", note: "both levels on the same day" }))).toBe("Target and stop both hit on 12 Oct 2026, counted as a miss");
    expect(levelsSentence(l({}))).toBe("Open until 4 Jan 2027");
    expect(levelsSentence(l({ horizonAssumed: true }))).toBe("Open until 4 Jan 2027 (horizon assumed 3 months)");
    expect(levelsSentence(l({ verdict: "expired" }))).toBe("Neither level hit by 4 Jan 2027");
    expect(levelsSentence(l({ verdict: "unscored", note: "Hold has no direction", touched: "target", date: "2026-10-12" }))).toBe("Hold, not scored on levels (target reached 12 Oct 2026)");
    expect(levelsSentence(l({ verdict: "unscored", note: "no levels" }))).toBe("No target or stop to score");
    expect(levelsSentence(l({ verdict: "unscored", note: "levels don't match the rating" }))).toBe("Target and stop don’t match the rating, not scored");
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `cd dashboard && pnpm exec vitest run lib/__tests__/ticker-series.test.ts lib/__tests__/outcome-text.test.ts`

- [ ] **Step 3: Implement pure helpers**

`dashboard/lib/ticker-series.ts`:

```ts
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
```

`dashboard/lib/outcome-text.ts`:

```ts
import { formatWhen } from "@/lib/format";
import type { LevelsOutcome, Verdict } from "@/lib/outcomes";

const LABEL: Record<Verdict, string> = { right: "Right", wrong: "Wrong", pending: "Open", expired: "Expired", unscored: "Not scored" };

export const verdictLabel = (v: Verdict) => LABEL[v];

const day = (date: string) => formatWhen(`${date}T00:00`).replace(", 00:00", "");

export function levelsSentence(l: LevelsOutcome): string {
  if (l.note === "no price data") return "No price data yet";
  if (l.note === "no levels") return "No target or stop to score";
  if (l.note === "levels don't match the rating") return "Target and stop don’t match the rating, not scored";
  if (l.note === "Hold has no direction") {
    return l.touched && l.date ? `Hold, not scored on levels (${l.touched === "stop" ? "stop" : "target"} reached ${day(l.date)})` : "Hold, not scored on levels";
  }
  if (l.touched === "both" && l.date) return `Target and stop both hit on ${day(l.date)}, counted as a miss`;
  if (l.touched && l.date) return `${l.touched === "target" ? "Target" : "Stop"} hit on ${day(l.date)}`;
  if (l.verdict === "expired") return `Neither level hit by ${day(l.horizonEnd)}`;
  return `Open until ${day(l.horizonEnd)}${l.horizonAssumed ? " (horizon assumed 3 months)" : ""}`;
}
```

(`benchmarkSentence` is added in Task 10 with its own test, where it is first used.)

- [ ] **Step 4: Run — expect PASS**

Run: `cd dashboard && pnpm exec vitest run lib/__tests__/ticker-series.test.ts lib/__tests__/outcome-text.test.ts`

- [ ] **Step 5: Charts**

`dashboard/components/charts/price-chart.tsx`:

```tsx
"use client";

import { useRouter } from "next/navigation";
import { CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { axisTick, useChartTokens } from "@/components/charts/use-chart-tokens";
import { ChartTooltipBox } from "@/components/charts/chart-tooltip";
import { formatDay, formatPrice, formatWhen } from "@/lib/format";
import type { PricePoint } from "@/lib/ticker-series";

const tickDay = (date: string) => formatDay(`${date}T00:00`);

export function PriceChart({ series, selectedId, target, stop }: { series: PricePoint[]; selectedId: string | null; target: number | null; stop: number | null }) {
  const t = useChartTokens();
  const router = useRouter();
  if (!t) return <div className="h-80" aria-hidden />;

  return (
    <div className="h-80" role="img" aria-label="Daily closing price with each run marked on its trade date">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={series} margin={{ top: 12, right: 88, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke={t.border} />
          <XAxis dataKey="date" tickFormatter={tickDay} minTickGap={56} tick={axisTick(t)} tickLine={false} axisLine={{ stroke: t.border }} />
          <YAxis domain={["auto", "auto"]} tickFormatter={(v: number) => formatPrice(v)} tick={axisTick(t)} tickLine={false} axisLine={false} width={64} />
          <Tooltip
            cursor={{ stroke: t.muted, strokeWidth: 1 }}
            content={({ active, payload }) => {
              const p = active ? (payload?.[0]?.payload as PricePoint | undefined) : undefined;
              if (!p) return null;
              return (
                <ChartTooltipBox>
                  <div className="font-semibold">{tickDay(p.date)}</div>
                  <div>Close {formatPrice(p.close)}</div>
                  {p.runs.map((r) => <div key={r.reportId}>{r.rating}, run {formatWhen(r.runAt)}</div>)}
                </ChartTooltipBox>
              );
            }}
          />
          {target != null && (
            <ReferenceLine y={target} stroke={t.ink} strokeDasharray="4 4" label={{ value: `Target ${formatPrice(target)}`, position: "right", fill: t.muted, fontSize: 12 }} />
          )}
          {stop != null && (
            <ReferenceLine y={stop} stroke={t.ink} strokeDasharray="2 4" label={{ value: `Stop ${formatPrice(stop)}`, position: "right", fill: t.muted, fontSize: 12 }} />
          )}
          <Line
            dataKey="close"
            stroke={t.ink}
            strokeWidth={2}
            isAnimationActive={false}
            activeDot={{ r: 4, fill: t.ink, stroke: t.surface, strokeWidth: 2 }}
            dot={(props: { cx?: number; cy?: number; index?: number; payload?: PricePoint }) => {
              const { cx, cy, index, payload } = props;
              if (cx == null || cy == null || !payload?.runs.length) return <g key={`d${index}`} />;
              const run = payload.runs[payload.runs.length - 1];
              const selected = payload.runs.some((r) => r.reportId === selectedId);
              return (
                <circle
                  key={`d${index}`}
                  cx={cx}
                  cy={cy}
                  r={selected ? 7 : 5}
                  fill={t.rating[run.rating] ?? t.ink}
                  stroke={selected ? t.ink : t.surface}
                  strokeWidth={2}
                  className="cursor-pointer"
                  onClick={() => router.replace(`?run=${encodeURIComponent(run.reportId)}`, { scroll: false })}
                />
              );
            }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
```

`dashboard/components/charts/rating-history-chart.tsx`:

```tsx
"use client";

import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { axisTick, useChartTokens } from "@/components/charts/use-chart-tokens";
import { ChartTooltipBox } from "@/components/charts/chart-tooltip";
import { formatDay } from "@/lib/format";
import type { PricePoint } from "@/lib/ticker-series";
import { RATINGS } from "@/lib/types";

const label = (step: number) => RATINGS[RATINGS.length - 1 - step] ?? "";

/** The committee's rating over time on the same dates as the price chart (its own chart, not a second axis). */
export function RatingHistoryChart({ series }: { series: PricePoint[] }) {
  const t = useChartTokens();
  if (!t) return <div className="h-44" aria-hidden />;
  return (
    <div className="h-44" role="img" aria-label="Rating at each date, from Buy at the top to Sell at the bottom">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={series} margin={{ top: 8, right: 88, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke={t.border} />
          <XAxis dataKey="date" tickFormatter={(d: string) => formatDay(`${d}T00:00`)} minTickGap={56} tick={axisTick(t)} tickLine={false} axisLine={{ stroke: t.border }} />
          <YAxis domain={[0, 4]} ticks={[0, 1, 2, 3, 4]} tickFormatter={label} tick={axisTick(t)} tickLine={false} axisLine={false} width={64} />
          <Tooltip
            cursor={{ stroke: t.muted, strokeWidth: 1 }}
            content={({ active, payload }) => {
              const p = active ? (payload?.[0]?.payload as PricePoint | undefined) : undefined;
              if (!p || p.ratingStep == null) return null;
              return <ChartTooltipBox>{formatDay(`${p.date}T00:00`)}: {label(p.ratingStep)}</ChartTooltipBox>;
            }}
          />
          <Line
            type="stepAfter"
            dataKey="ratingStep"
            stroke={t.muted}
            strokeWidth={2}
            connectNulls={false}
            isAnimationActive={false}
            dot={(props: { cx?: number; cy?: number; index?: number; payload?: PricePoint }) => {
              const { cx, cy, index, payload } = props;
              if (cx == null || cy == null || !payload?.runs.length) return <g key={`r${index}`} />;
              const rating = payload.runs[payload.runs.length - 1].rating;
              return <circle key={`r${index}`} cx={cx} cy={cy} r={5} fill={t.rating[rating] ?? t.ink} stroke={t.surface} strokeWidth={2} />;
            }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
```

If `tsc` rejects the inline `dot` callback's parameter type, cast at the call site (`dot={renderDot as never}`) and ledger it as a ruling — Recharts' dot prop type is a union that the narrower parameter type may not satisfy.

`dashboard/components/runs-table.tsx`:

```tsx
import Link from "next/link";
import { RatingTag } from "@/components/rating-tag";
import { formatPercent, formatPrice, formatWhen } from "@/lib/format";
import { levelsSentence, verdictLabel } from "@/lib/outcome-text";
import type { Scorecard } from "@/lib/scorecard";
import { cn } from "@/lib/utils";

const th = "py-2 pr-4 text-left text-sm font-normal text-muted-foreground align-bottom";
const td = "border-t border-border py-3 pr-4 align-top";

export function RunsTable({ cards, selectedId }: { cards: Scorecard[]; selectedId: string | null }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[60rem] border-collapse text-[0.9375rem]">
        <thead>
          <tr>
            <th className={th}>Run</th>
            <th className={th}>Trade date</th>
            <th className={th}>Rating</th>
            <th className={`${th} text-right`}>Entry</th>
            <th className={`${th} text-right`}>Target</th>
            <th className={`${th} text-right`}>Stop</th>
            <th className={th}>Target vs stop</th>
            <th className={`${th} text-right`}>5 days</th>
            <th className={`${th} text-right`}>20 days</th>
            <th className={th}>Beat the benchmark</th>
            <th className={th}>Absolute return</th>
          </tr>
        </thead>
        <tbody>
          {cards.map((c) => {
            const o = c.outcome;
            const s = c.report.summary;
            return (
              <tr key={c.report.id} className={cn(c.report.id === selectedId && "bg-card")}>
                <td className={td}>
                  <Link href={`?run=${encodeURIComponent(c.report.id)}`} scroll={false} aria-current={c.report.id === selectedId ? "true" : undefined} className="whitespace-nowrap underline-offset-4 hover:underline">
                    {formatWhen(c.report.runAt)}
                  </Link>
                  <div><Link href={`/reports/${encodeURIComponent(c.report.id)}`} className="text-sm text-muted-foreground underline underline-offset-4">Report</Link></div>
                </td>
                <td className={`${td} whitespace-nowrap`}>
                  {c.tradeDate.date}
                  {c.tradeDate.source === "run-date" && <div className="text-xs text-muted-foreground">inferred from run date</div>}
                </td>
                <td className={td}><RatingTag rating={s.rating} /></td>
                <td className={`${td} text-right`}>{formatPrice(o.entry?.close)}</td>
                <td className={`${td} text-right`}>{formatPrice(s.price_target)}</td>
                <td className={`${td} text-right`}>{formatPrice(s.stop_loss)}</td>
                <td className={`${td} min-w-48`}>
                  <span className="font-medium">{verdictLabel(o.levels.verdict)}</span>
                  <div className="text-sm text-muted-foreground">{levelsSentence(o.levels)}</div>
                </td>
                <td className={`${td} text-right whitespace-nowrap`}>
                  {formatPercent(o.d5.ret, { signed: true })}
                  <div className="text-xs text-muted-foreground">{formatPercent(o.d5.alpha, { signed: true })} vs {c.benchmark ?? "index"}</div>
                </td>
                <td className={`${td} text-right whitespace-nowrap`}>
                  {formatPercent(o.d20.ret, { signed: true })}
                  <div className="text-xs text-muted-foreground">{formatPercent(o.d20.alpha, { signed: true })} vs {c.benchmark ?? "index"}</div>
                </td>
                <td className={td}>{verdictLabel(o.d20.benchmark)}</td>
                <td className={td}>{verdictLabel(o.d20.absolute)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 6: Ticker page**

`dashboard/app/tickers/[ticker]/page.tsx`:

```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChartFrame, tableClasses } from "@/components/charts/chart-frame";
import { PriceChart } from "@/components/charts/price-chart";
import { RatingHistoryChart } from "@/components/charts/rating-history-chart";
import { PriceFreshness } from "@/components/price-freshness";
import { RatingScaleMarker } from "@/components/rating-scale-marker";
import { RatingTag } from "@/components/rating-tag";
import { RunsTable } from "@/components/runs-table";
import { formatDay, formatPrice } from "@/lib/format";
import { NotFoundError, decodeRouteParam } from "@/lib/paths";
import { pricesStale, readBars, readPriceIndex } from "@/lib/prices";
import { listReports } from "@/lib/reports";
import { loadScorecards } from "@/lib/scorecard";
import { buildPriceSeries } from "@/lib/ticker-series";

export const dynamic = "force-dynamic";

export default async function TickerPage({ params, searchParams }: { params: Promise<{ ticker: string }>; searchParams: Promise<{ run?: string }> }) {
  let ticker: string;
  try {
    ticker = decodeRouteParam((await params).ticker);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const reports = (await listReports()).filter((r) => r.ticker === ticker);
  if (!reports.length) notFound();

  const cards = (await loadScorecards()).filter((c) => c.report.ticker === ticker).sort((a, b) => b.report.runAt.localeCompare(a.report.runAt));
  const index = await readPriceIndex();
  const mapping = index.tickers[ticker];
  const bars = mapping ? await readBars(mapping.symbol) : null;
  const series = bars ? buildPriceSeries(bars, cards) : [];
  const runId = (await searchParams).run;
  const selected = cards.find((c) => c.report.id === runId) ?? cards[0] ?? null;
  const latest = reports[0];
  const priceError = mapping ? index.errors[mapping.symbol] ?? (bars ? null : "No price data for this ticker.") : "Prices haven't been fetched for this ticker yet.";

  return (
    <div className="space-y-12">
      <header className="grid gap-8 border-b border-border pb-10 lg:grid-cols-[1fr_22rem] lg:items-end">
        <div>
          <h1 className="text-[clamp(4.5rem,13vw,9rem)] leading-[0.82] font-extrabold tracking-[-0.055em] break-words">{ticker}</h1>
          <p className="mt-4 text-muted-foreground">
            {reports.length} run{reports.length > 1 ? "s" : ""}.{" "}
            <Link href={`/reports/${encodeURIComponent(latest.id)}`} className="underline underline-offset-4">Latest report</Link>
          </p>
        </div>
        <div className="space-y-5">
          {latest.summary && (
            <>
              <RatingTag rating={latest.summary.rating} className="text-2xl font-bold tracking-[-0.02em]" />
              <RatingScaleMarker rating={latest.summary.rating} />
            </>
          )}
          <PriceFreshness fetchedAt={index.fetched_at} stale={pricesStale(index)} errors={mapping && index.errors[mapping.symbol] ? { [mapping.symbol]: index.errors[mapping.symbol] } : {}} />
        </div>
      </header>

      {series.length > 0 ? (
        <section className="space-y-10">
          <ChartFrame
            title="Price and verdict levels"
            description={selected ? `Dots mark each run on its trade date. Dashed lines show the target and stop of the run from ${formatDay(selected.report.runAt)}; select another run in the table below.` : "Daily close."}
            table={
              <table className={tableClasses.table}>
                <thead><tr><th className={tableClasses.th}>Date</th><th className={`${tableClasses.th} text-right`}>Close</th><th className={tableClasses.th}>Runs</th></tr></thead>
                <tbody>
                  {series.filter((p) => p.runs.length).map((p) => (
                    <tr key={p.date}><td className={tableClasses.td}>{p.date}</td><td className={`${tableClasses.td} text-right`}>{formatPrice(p.close)}</td><td className={tableClasses.td}>{p.runs.map((r) => r.rating).join(", ")}</td></tr>
                  ))}
                </tbody>
              </table>
            }
          >
            <PriceChart series={series} selectedId={selected?.report.id ?? null} target={selected?.report.summary.price_target ?? null} stop={selected?.report.summary.stop_loss ?? null} />
          </ChartFrame>
          <ChartFrame
            title="Rating history"
            description="The committee’s rating on each date, carried forward until the next run."
            table={
              <table className={tableClasses.table}>
                <thead><tr><th className={tableClasses.th}>Trade date</th><th className={tableClasses.th}>Rating</th></tr></thead>
                <tbody>{cards.map((c) => <tr key={c.report.id}><td className={tableClasses.td}>{c.tradeDate.date}</td><td className={tableClasses.td}>{c.report.summary.rating}</td></tr>)}</tbody>
              </table>
            }
          >
            <RatingHistoryChart series={series} />
          </ChartFrame>
        </section>
      ) : (
        <p className="text-muted-foreground">{priceError ?? "No price data yet."} Refresh prices to draw the charts.</p>
      )}

      <section className="space-y-4">
        <h2 className="text-xl font-bold tracking-[-0.02em]">Runs</h2>
        {cards.length ? <RunsTable cards={cards} selectedId={selected?.report.id ?? null} /> : <p className="text-muted-foreground">No summarized runs yet. Summarize a report to score it.</p>}
      </section>
    </div>
  );
}
```

`dashboard/app/tickers/[ticker]/not-found.tsx`:

```tsx
import Link from "next/link";

export default function NotFound() {
  return (
    <div className="space-y-4">
      <h1 className="text-3xl font-bold tracking-[-0.03em]">No reports for this ticker</h1>
      <Link href="/" className="underline underline-offset-4">Back to verdicts</Link>
    </div>
  );
}
```

- [ ] **Step 7: Verify**

Run: `cd dashboard && pnpm test && pnpm exec tsc --noEmit && pnpm lint && pnpm build`

- [ ] **Step 8: Commit**

```bash
git add dashboard && git commit -m "feat(dashboard): add ticker page with price, levels and rating history"
```

---

### Task 9: Insights page

**Files:**
- Create: `dashboard/components/charts/hit-rate-chart.tsx`, `alpha-chart.tsx`, `runs-per-week-chart.tsx`, `dashboard/app/insights/page.tsx`

**Interfaces:**
- Consumes: `loadScorecards`, `summarizeScorecards`, `ScoreSummary`, `MeasureStats`, `runsPerWeek`, `listReports`, `readPriceIndex`, `pricesStale`, chart primitives, `PriceFreshness`, `formatRate`, `formatPercent`, `formatDay`, `todayLocal`.
- Produces: `<HitRateChart rows={ScoreSummary["byRating"]} />` (client, own measure toggle), `<AlphaChart rows={…} />`, `<RunsPerWeekChart weeks={{week,count}[]} />`.

- [ ] **Step 1: Charts**

`dashboard/components/charts/hit-rate-chart.tsx`:

```tsx
"use client";

import { useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, XAxis, YAxis } from "recharts";
import { ChartFrame, tableClasses } from "@/components/charts/chart-frame";
import { axisTick, useChartTokens } from "@/components/charts/use-chart-tokens";
import { formatRate } from "@/lib/format";
import type { ScoreSummary } from "@/lib/scorecard";
import { cn } from "@/lib/utils";

const MEASURES = [
  { key: "levels", label: "Target vs stop" },
  { key: "benchmark", label: "Beat the benchmark" },
  { key: "absolute", label: "Absolute return" },
] as const;
type MeasureKey = (typeof MEASURES)[number]["key"];

export function HitRateChart({ rows }: { rows: ScoreSummary["byRating"] }) {
  const t = useChartTokens();
  const [measure, setMeasure] = useState<MeasureKey>("levels");
  const data = rows
    .map((r) => ({ rating: r.rating, rate: r[measure].rate, settled: r[measure].right + r[measure].wrong }))
    .filter((r) => r.rate != null);

  return (
    <ChartFrame
      title="Hit rate by rating"
      description="Share of settled verdicts that were right."
      table={
        <table className={tableClasses.table}>
          <thead><tr><th className={tableClasses.th}>Rating</th>{MEASURES.map((m) => <th key={m.key} className={`${tableClasses.th} text-right`}>{m.label}</th>)}</tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.rating}>
                <td className={tableClasses.td}>{r.rating}</td>
                {MEASURES.map((m) => <td key={m.key} className={`${tableClasses.td} text-right`}>{formatRate(r[m.key].rate)} ({r[m.key].right} of {r[m.key].right + r[m.key].wrong})</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      }
    >
      <div role="group" aria-label="Measure" className="flex flex-wrap gap-1">
        {MEASURES.map((m) => (
          <button
            key={m.key}
            type="button"
            aria-pressed={measure === m.key}
            onClick={() => setMeasure(m.key)}
            className={cn("rounded-[3px] px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground", measure === m.key && "bg-card font-semibold text-foreground")}
          >
            {m.label}
          </button>
        ))}
      </div>
      {!t ? (
        <div className="h-56" aria-hidden />
      ) : data.length === 0 ? (
        <p className="py-10 text-muted-foreground">No settled verdicts for this measure yet.</p>
      ) : (
        <div style={{ height: 48 * data.length + 32 }} role="img" aria-label={`Hit rate by rating, ${MEASURES.find((m) => m.key === measure)!.label}`}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} layout="vertical" margin={{ top: 0, right: 96, bottom: 0, left: 0 }} barCategoryGap={8}>
              <CartesianGrid horizontal={false} stroke={t.border} />
              <XAxis type="number" domain={[0, 1]} tickFormatter={(v: number) => formatRate(v)} tick={axisTick(t)} tickLine={false} axisLine={false} />
              <YAxis type="category" dataKey="rating" tick={{ ...axisTick(t), fill: t.ink }} tickLine={false} axisLine={false} width={96} />
              <Bar dataKey="rate" radius={[0, 4, 4, 0]} isAnimationActive={false}>
                {data.map((d) => <Cell key={d.rating} fill={t.rating[d.rating]} />)}
                <LabelList
                  dataKey="rate"
                  position="right"
                  fill={t.ink}
                  fontSize={12}
                  formatter={(v: unknown) => formatRate(typeof v === "number" ? v : null)}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </ChartFrame>
  );
}
```

`dashboard/components/charts/alpha-chart.tsx`:

```tsx
"use client";

import { Bar, BarChart, CartesianGrid, Cell, LabelList, ReferenceLine, Rectangle, ResponsiveContainer, XAxis, YAxis } from "recharts";
import { ChartFrame, tableClasses } from "@/components/charts/chart-frame";
import { axisTick, useChartTokens } from "@/components/charts/use-chart-tokens";
import { formatPercent } from "@/lib/format";
import type { ScoreSummary } from "@/lib/scorecard";

export function AlphaChart({ rows }: { rows: ScoreSummary["byRating"] }) {
  const t = useChartTokens();
  const data = rows.filter((r) => r.avgAlpha20 != null).map((r) => ({ rating: r.rating, alpha: r.avgAlpha20 as number, n: r.alphaN }));
  const max = Math.max(0.01, ...data.map((d) => Math.abs(d.alpha))) * 1.25;

  return (
    <ChartFrame
      title="Return against the benchmark after 20 trading days"
      description="Average by rating. Buys should sit right of zero and sells left of it."
      table={
        <table className={tableClasses.table}>
          <thead><tr><th className={tableClasses.th}>Rating</th><th className={`${tableClasses.th} text-right`}>Average</th><th className={`${tableClasses.th} text-right`}>Verdicts</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.rating}><td className={tableClasses.td}>{r.rating}</td><td className={`${tableClasses.td} text-right`}>{formatPercent(r.avgAlpha20, { signed: true })}</td><td className={`${tableClasses.td} text-right`}>{r.alphaN}</td></tr>)}</tbody>
        </table>
      }
    >
      {!t ? (
        <div className="h-56" aria-hidden />
      ) : data.length === 0 ? (
        <p className="py-10 text-muted-foreground">No verdict has 20 trading days of prices yet.</p>
      ) : (
        <div style={{ height: 48 * data.length + 32 }} role="img" aria-label="Average 20-day return against the benchmark by rating">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} layout="vertical" margin={{ top: 0, right: 112, bottom: 0, left: 0 }} barCategoryGap={8}>
              <CartesianGrid horizontal={false} stroke={t.border} />
              <XAxis type="number" domain={[-max, max]} tickFormatter={(v: number) => formatPercent(v, { signed: true, digits: 0 })} tick={axisTick(t)} tickLine={false} axisLine={false} />
              <YAxis type="category" dataKey="rating" tick={{ ...axisTick(t), fill: t.ink }} tickLine={false} axisLine={false} width={96} />
              <ReferenceLine x={0} stroke={t.muted} />
              <Bar
                dataKey="alpha"
                isAnimationActive={false}
                // Round only the data end; the end on the zero line stays square.
                shape={(props: Record<string, unknown>) => (
                  <Rectangle {...props} radius={(props.alpha as number) < 0 ? [4, 0, 0, 4] : [0, 4, 4, 0]} />
                )}
              >
                {data.map((d) => <Cell key={d.rating} fill={t.rating[d.rating]} />)}
                <LabelList
                  dataKey="alpha"
                  position="right"
                  fill={t.ink}
                  fontSize={12}
                  formatter={(v: unknown) => (typeof v === "number" ? formatPercent(v, { signed: true }) : "")}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </ChartFrame>
  );
}
```

`dashboard/components/charts/runs-per-week-chart.tsx`:

```tsx
"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartFrame, tableClasses } from "@/components/charts/chart-frame";
import { ChartTooltipBox } from "@/components/charts/chart-tooltip";
import { axisTick, useChartTokens } from "@/components/charts/use-chart-tokens";
import { formatDay } from "@/lib/format";

const week = (d: string) => formatDay(`${d}T00:00`);

export function RunsPerWeekChart({ weeks }: { weeks: { week: string; count: number }[] }) {
  const t = useChartTokens();
  return (
    <ChartFrame
      title="Runs per week"
      description="Reports run in each of the last 26 weeks, by the Monday each week starts."
      table={
        <table className={tableClasses.table}>
          <thead><tr><th className={tableClasses.th}>Week of</th><th className={`${tableClasses.th} text-right`}>Runs</th></tr></thead>
          <tbody>{weeks.filter((w) => w.count).map((w) => <tr key={w.week}><td className={tableClasses.td}>{week(w.week)}</td><td className={`${tableClasses.td} text-right`}>{w.count}</td></tr>)}</tbody>
        </table>
      }
    >
      {!t ? (
        <div className="h-48" aria-hidden />
      ) : (
        <div className="h-48" role="img" aria-label="Runs per week over the last 26 weeks">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={weeks} margin={{ top: 8, right: 0, bottom: 0, left: 0 }} barCategoryGap={2}>
              <CartesianGrid vertical={false} stroke={t.border} />
              <XAxis dataKey="week" tickFormatter={week} minTickGap={40} tick={axisTick(t)} tickLine={false} axisLine={{ stroke: t.border }} />
              <YAxis allowDecimals={false} tick={axisTick(t)} tickLine={false} axisLine={false} width={32} />
              <Tooltip
                cursor={{ fill: t.border, opacity: 0.4 }}
                content={({ active, payload }) => {
                  const w = active ? (payload?.[0]?.payload as { week: string; count: number } | undefined) : undefined;
                  return w ? <ChartTooltipBox>Week of {week(w.week)}: {w.count} run{w.count === 1 ? "" : "s"}</ChartTooltipBox> : null;
                }}
              />
              <Bar dataKey="count" fill={t.ink} radius={[4, 4, 0, 0]} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </ChartFrame>
  );
}
```

- [ ] **Step 2: Insights page** — `dashboard/app/insights/page.tsx`:

```tsx
import { AlphaChart } from "@/components/charts/alpha-chart";
import { HitRateChart } from "@/components/charts/hit-rate-chart";
import { RunsPerWeekChart } from "@/components/charts/runs-per-week-chart";
import { PriceFreshness } from "@/components/price-freshness";
import { runsPerWeek } from "@/lib/calendar";
import { formatRate, todayLocal } from "@/lib/format";
import { pricesStale, readPriceIndex } from "@/lib/prices";
import { listReports } from "@/lib/reports";
import { loadScorecards, summarizeScorecards, type MeasureStats } from "@/lib/scorecard";

export const dynamic = "force-dynamic";

function Counts({ s }: { s: MeasureStats }) {
  return (
    <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
      <div className="flex gap-1.5"><dt className="text-muted-foreground">Right</dt><dd className="font-semibold">{s.right}</dd></div>
      <div className="flex gap-1.5"><dt className="text-muted-foreground">Wrong</dt><dd className="font-semibold">{s.wrong}</dd></div>
      <div className="flex gap-1.5"><dt className="text-muted-foreground">Open</dt><dd className="font-semibold">{s.pending}</dd></div>
      <div className="flex gap-1.5"><dt className="text-muted-foreground">Not counted</dt><dd className="font-semibold">{s.notCounted}</dd></div>
    </dl>
  );
}

export default async function InsightsPage() {
  const [cards, reports, index] = await Promise.all([loadScorecards(), listReports(), readPriceIndex()]);
  const summary = summarizeScorecards(cards);
  const weeks = runsPerWeek(reports.map((r) => r.runAt.slice(0, 10)), 26, todayLocal());

  return (
    <div className="space-y-16">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold tracking-[-0.03em]">Insights</h1>
          <p className="max-w-2xl text-muted-foreground">How the committee’s summarized verdicts played out against later prices.</p>
        </div>
        <PriceFreshness fetchedAt={index.fetched_at} stale={pricesStale(index)} errors={index.errors} />
      </div>

      {cards.length === 0 ? (
        <p className="max-w-xl text-muted-foreground">No summarized verdicts yet. Summarize reports on the Verdicts page to score them here.</p>
      ) : (
        <section className="grid gap-10 border-b border-border pb-12 lg:grid-cols-[1.4fr_1fr]">
          <div className="space-y-4">
            <p className="text-[clamp(4.5rem,11vw,8rem)] leading-[0.85] font-extrabold tracking-[-0.05em]">{formatRate(summary.levels.rate)}</p>
            <p className="text-lg font-semibold">reached the target before the stop</p>
            <Counts s={summary.levels} />
            {summary.levels.rate == null && (
              <p className="text-sm text-muted-foreground">No settled verdicts yet. A verdict settles when its target or stop is touched, or expires when its horizon ends.</p>
            )}
          </div>
          <div className="space-y-8">
            <div className="space-y-2">
              <p className="text-4xl font-bold tracking-[-0.03em]">{formatRate(summary.benchmark.rate)}</p>
              <p className="font-semibold">beat the benchmark after 20 trading days</p>
              <Counts s={summary.benchmark} />
            </div>
            <div className="space-y-2">
              <p className="text-4xl font-bold tracking-[-0.03em]">{formatRate(summary.absolute.rate)}</p>
              <p className="font-semibold">moved the way they were called after 20 trading days</p>
              <Counts s={summary.absolute} />
            </div>
          </div>
        </section>
      )}

      {cards.length > 0 && (
        <div className="grid gap-14 lg:grid-cols-2">
          <HitRateChart rows={summary.byRating} />
          <AlphaChart rows={summary.byRating} />
        </div>
      )}
      <RunsPerWeekChart weeks={weeks} />
    </div>
  );
}
```

- [ ] **Step 3: Verify**

Run: `cd dashboard && pnpm exec tsc --noEmit && pnpm lint && pnpm test && pnpm build`

- [ ] **Step 4: Commit**

```bash
git add dashboard && git commit -m "feat(dashboard): add insights page with hit rates, alpha by rating and runs per week"
```

---

### Task 10: Report outcome line, links, visual QA

**Files:**
- Modify: `dashboard/lib/outcome-text.ts` (add `benchmarkSentence`), `dashboard/app/reports/[id]/page.tsx`
- Test: `dashboard/lib/__tests__/outcome-text.test.ts`

**Interfaces:**
- Consumes: `loadScorecard`, `readPriceIndex`, `pricesStale`, `PriceFreshness`, `levelsSentence`.
- Produces: `benchmarkSentence(outcome: Outcome, benchmark: string | null): string`.

- [ ] **Step 1: Write the failing test** — append to `outcome-text.test.ts`:

```ts
import { benchmarkSentence } from "@/lib/outcome-text";
import type { Outcome } from "@/lib/outcomes";

describe("benchmarkSentence", () => {
  const o = (d20: Partial<Outcome["d20"]>, d5: Partial<Outcome["d5"]> = {}) =>
    ({ d5: { days: 5, ret: null, alpha: null, benchmark: "pending", absolute: "pending", ...d5 }, d20: { days: 20, ret: null, alpha: null, benchmark: "pending", absolute: "pending", ...d20 } }) as Outcome;
  it("prefers 20 days, falls back to 5, then pending", () => {
    expect(benchmarkSentence(o({ alpha: 0.031 }), "SPY")).toBe("+3.1% vs SPY after 20 trading days");
    expect(benchmarkSentence(o({}, { alpha: -0.004 }), "SPY")).toBe("−0.4% vs SPY after 5 trading days");
    expect(benchmarkSentence(o({}), "SPY")).toBe("Benchmark comparison pending");
    expect(benchmarkSentence(o({}), null)).toBe("Benchmark comparison pending");
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (`benchmarkSentence` not exported)

Run: `cd dashboard && pnpm exec vitest run lib/__tests__/outcome-text.test.ts`

- [ ] **Step 3: Implement** — append to `dashboard/lib/outcome-text.ts`:

```ts
import { formatPercent } from "@/lib/format";
import type { Outcome } from "@/lib/outcomes";

export function benchmarkSentence(outcome: Outcome, benchmark: string | null): string {
  const w = outcome.d20.alpha != null ? outcome.d20 : outcome.d5.alpha != null ? outcome.d5 : null;
  if (!w || !benchmark) return "Benchmark comparison pending";
  return `${formatPercent(w.alpha, { signed: true })} vs ${benchmark} after ${w.days} trading days`;
}
```

(Merge the new imports into the file's existing import lines.)

- [ ] **Step 4: Report page** — in `dashboard/app/reports/[id]/page.tsx`:

Add imports:

```tsx
import Link from "next/link";
import { PriceFreshness } from "@/components/price-freshness";
import { benchmarkSentence, levelsSentence } from "@/lib/outcome-text";
import { pricesStale, readPriceIndex } from "@/lib/prices";
import { loadScorecard } from "@/lib/scorecard";
```

After `const { summary } = report;` add:

```tsx
  const [card, priceIndex] = await Promise.all([loadScorecard(report.id), readPriceIndex()]);
```

Inside the header's right column, directly after the `<dl>…</dl>` (still inside the `summary ?` branch), add:

```tsx
              {card && (
                <div className="space-y-1 border-t border-border pt-4 text-[0.9375rem]">
                  <p className="font-semibold">{levelsSentence(card.outcome.levels)}</p>
                  <p className="text-muted-foreground">{benchmarkSentence(card.outcome, card.benchmark)}</p>
                </div>
              )}
```

Below the `SummarizeButton` block in the same column add:

```tsx
          <div className="space-y-3">
            <Link href={`/tickers/${encodeURIComponent(report.ticker)}`} className="underline underline-offset-4">Price and history</Link>
            {summary && <PriceFreshness fetchedAt={priceIndex.fetched_at} stale={pricesStale(priceIndex)} errors={{}} />}
          </div>
```

- [ ] **Step 5: Run all tests and build**

Run: `cd dashboard && pnpm test && pnpm exec tsc --noEmit && pnpm lint && pnpm build && cd .. && .venv/bin/python -m pytest dashboard/worker/tests -q`

- [ ] **Step 6: Visual QA (no LLM spend; prices fetched from Yahoo)**

1. Build a fixture reports dir as in the redesign QA (copy `reports/*_2026*` + `_batches`, add fixture summaries across all five ratings with realistic targets/stops relative to recent prices).
2. Start `TA_PYTHON=$PWD/../.venv/bin/python TA_REPORTS_DIR=<fixture> PORT=3141 pnpm start` (real python so the price refresh works).
3. Visit `/insights` → prices refresh automatically; hero, three charts, tables render. `/calendar` → September and October 2026 show runs; clicking a day lists them. `/tickers/SPY` → price line with dots, dashed levels, rating history aligned below; clicking a dot / table row switches levels. Report page shows the outcome line and "Price and history".
4. Screenshot each in light, dark, and 390 px; check: no horizontal page overflow (`scrollWidth === clientWidth`), labels don't collide, tooltips appear on hover, keyboard focus visible on calendar cells and the measure toggle.
5. Stop the server by PID (`pgrep -f '^next-server'` + cwd check), never `pkill -f`.

- [ ] **Step 7: Commit**

```bash
git add dashboard && git commit -m "feat(dashboard): show verdict outcomes on report pages and link to ticker history"
```
