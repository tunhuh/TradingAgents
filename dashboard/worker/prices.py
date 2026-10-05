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
    # Save the mapping and each symbol's result as we go: the API stops the worker after
    # a timeout, and whatever was fetched by then must still be usable.
    index["tickers"].update(mapping)
    write_json_atomic(index_path, index)
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
        write_json_atomic(index_path, index)
    # Only a refresh that actually fetched something counts as fresh; otherwise the
    # dashboard keeps showing the old time and retries on the next visit.
    if fetched:
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
