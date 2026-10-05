"""Run one dashboard batch: analyse each ticker in turn and record progress.

Usage: python -m dashboard.worker.run_batch <batch_id>

Progress goes to reports/_batches/<batch_id>.json (read by the Next.js app).
SIGTERM cancels: the ticker in flight is abandoned and the rest are skipped.
"""

from __future__ import annotations

import logging
import os
import signal
import sys
from datetime import datetime

from dashboard.worker import batch_store
from dashboard.worker.common import load_config, now_iso, reports_dir, write_json_atomic

logger = logging.getLogger(__name__)


class Cancelled(BaseException):
    """Raised from the SIGTERM handler. BaseException so library `except Exception` blocks don't swallow it."""


def _raise_cancelled(signum, frame):
    raise Cancelled()


def _error_text(exc: BaseException) -> str:
    return f"{type(exc).__name__}: {exc}"[:500]


def _default_graph_factory(analysts: list[str], config: dict):
    from tradingagents.graph.trading_graph import TradingAgentsGraph

    return TradingAgentsGraph(selected_analysts=analysts, config=config)


def _default_summarizer(config: dict):
    from dashboard.worker.summarize import build_llm, summarize_report

    llm, label = build_llm(config)
    return lambda report_dir: summarize_report(report_dir, llm, label)


def _run_one(ticker: str, params: dict, config: dict, graphs: dict, graph_factory, batch_id: str) -> tuple[str, str]:
    from cli.models import AnalystType
    from cli.utils import detect_asset_type, filter_analysts_for_asset_type, normalize_ticker_symbol
    from tradingagents.dataflows.utils import safe_ticker_component

    # Same canonicalization as the CLI (BTCUSD -> BTC-USD, XAUUSD -> GC=F); offline.
    ticker = normalize_ticker_symbol(ticker)
    asset_type = detect_asset_type(ticker)
    analysts = [
        a.value
        for a in filter_analysts_for_asset_type([AnalystType(a) for a in params["analysts"]], asset_type)
    ]
    if not analysts:
        raise ValueError(f"no selected analyst supports {asset_type.value} tickers")
    # The analyst set is fixed at graph construction, so cache one graph per set.
    key = tuple(analysts)
    if key not in graphs:
        graphs[key] = graph_factory(analysts, config)
    graph = graphs[key]

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


def run(batch_id: str, *, graph_factory=None, summarizer=None) -> dict:
    batch = batch_store.load(batch_id)
    params = batch["params"]
    batch.update(status="running", pid=os.getpid())
    batch_store.save(batch)

    graph_factory = graph_factory or _default_graph_factory
    cancelled = False
    try:
        config = load_config()
        config["max_debate_rounds"] = params["max_debate_rounds"]
        config["max_risk_discuss_rounds"] = params["max_risk_discuss_rounds"]
        graphs: dict = {}
        summarize = summarizer
        for index, item in enumerate(batch["items"]):
            batch_store.mark_item(batch, index, status="running", started_at=now_iso())
            try:
                report_id, rating = _run_one(item["ticker"], params, config, graphs, graph_factory, batch_id)
            except Exception as exc:
                logger.exception("analysis failed for %s", item["ticker"])
                batch_store.mark_item(batch, index, status="failed", finished_at=now_iso(), error=_error_text(exc))
                continue
            batch_store.mark_item(
                batch, index, status="done", finished_at=now_iso(), report_id=report_id, signal=rating,
            )
            if params.get("auto_summarize"):
                try:
                    if summarize is None:
                        summarize = _default_summarizer(config)
                    summarize(reports_dir() / report_id)
                    batch_store.mark_item(batch, index, summary_status="done")
                except Exception as exc:
                    logger.exception("summary failed for %s", report_id)
                    batch_store.mark_item(batch, index, summary_status="failed", error=f"summary: {_error_text(exc)}")
    except Cancelled:
        cancelled = True
    except Exception as exc:
        logger.exception("batch %s aborted", batch_id)
        batch["error"] = _error_text(exc)
    finally:
        batch_store.finalize(batch, cancelled=cancelled)
    return batch


def main(argv: list[str] | None = None) -> int:
    args = sys.argv[1:] if argv is None else argv
    if len(args) != 1:
        print("usage: python -m dashboard.worker.run_batch <batch_id>", file=sys.stderr)
        return 2
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    signal.signal(signal.SIGTERM, _raise_cancelled)
    batch = run(args[0])
    print(f"batch {batch['id']} finished: {batch['status']}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
