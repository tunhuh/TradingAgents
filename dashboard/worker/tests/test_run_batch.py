import json

import pytest

from dashboard.worker import run_batch


@pytest.fixture
def reports(tmp_path, monkeypatch):
    monkeypatch.setenv("TA_REPORTS_DIR", str(tmp_path))
    monkeypatch.setattr(run_batch, "load_config", lambda: {"max_debate_rounds": 9, "max_risk_discuss_rounds": 9})
    return tmp_path


def write_batch(reports, tickers, analysts=("market", "news", "fundamentals"), auto_summarize=True):
    batch = {
        "id": "20261005_101500_a1b2", "created_at": "2026-10-05T10:15:00Z",
        "updated_at": "2026-10-05T10:15:00Z", "status": "queued", "pid": None, "error": None,
        "params": {"tickers": tickers, "trade_date": "2026-10-03", "analysts": list(analysts),
                   "max_debate_rounds": 2, "max_risk_discuss_rounds": 1, "auto_summarize": auto_summarize},
        "items": [{"ticker": t, "status": "pending", "started_at": None, "finished_at": None,
                   "report_id": None, "signal": None, "summary_status": "none", "error": None} for t in tickers],
    }
    (reports / "_batches").mkdir()
    (reports / "_batches" / "20261005_101500_a1b2.json").write_text(json.dumps(batch))


class FakeGraphs:
    def __init__(self, fail=(), cancel_on=None):
        self.created, self.calls, self.fail, self.cancel_on = [], [], set(fail), cancel_on

    def __call__(self, analysts, config):
        self.created.append((tuple(analysts), config["max_debate_rounds"]))
        outer = self

        class G:
            def propagate(self, ticker, date, asset_type):
                outer.calls.append((ticker, date, asset_type, tuple(analysts)))
                if ticker == outer.cancel_on:
                    raise run_batch.Cancelled()
                if ticker in outer.fail:
                    raise RuntimeError(f"data vendor down for {ticker}")
                return {"ticker": ticker}, "Buy"

            def save_reports(self, state, ticker, path):
                path.mkdir(parents=True)
                (path / "complete_report.md").write_text(f"report {ticker}")

        return G()


def saved(reports):
    return json.loads((reports / "_batches" / "20261005_101500_a1b2.json").read_text())


def test_all_tickers_succeed(reports):
    write_batch(reports, ["NVDA", "MSFT"])
    graphs, summarized = FakeGraphs(), []
    run_batch.run("20261005_101500_a1b2", graph_factory=graphs, summarizer=summarized.append)

    batch = saved(reports)
    assert batch["status"] == "done"
    assert batch["pid"] is not None
    assert [i["status"] for i in batch["items"]] == ["done", "done"]
    assert all(i["signal"] == "Buy" and i["summary_status"] == "done" for i in batch["items"])
    for item in batch["items"]:
        assert item["report_id"].startswith(item["ticker"] + "_")
        assert (reports / item["report_id"] / "complete_report.md").exists()
    assert [p.name for p in summarized] == [i["report_id"] for i in batch["items"]]
    # one graph reused; rounds from params override config
    assert graphs.created == [(("market", "news", "fundamentals"), 2)]


def test_one_failure_gives_partial_and_continues(reports):
    write_batch(reports, ["NVDA", "BAD", "MSFT"], auto_summarize=False)
    run_batch.run("20261005_101500_a1b2", graph_factory=FakeGraphs(fail={"BAD"}), summarizer=None)
    batch = saved(reports)
    assert batch["status"] == "partial"
    assert [i["status"] for i in batch["items"]] == ["done", "failed", "done"]
    assert batch["items"][1]["error"] == "RuntimeError: data vendor down for BAD"
    assert all(i["summary_status"] == "none" for i in batch["items"])


def test_crypto_drops_fundamentals_and_gets_its_own_graph(reports):
    # BTCUSD is normalized to the canonical Yahoo symbol, exactly as the CLI does.
    write_batch(reports, ["NVDA", "BTCUSD"], auto_summarize=False)
    graphs = FakeGraphs()
    run_batch.run("20261005_101500_a1b2", graph_factory=graphs)
    assert graphs.calls[1] == ("BTC-USD", "2026-10-03", "crypto", ("market", "news"))
    assert len(graphs.created) == 2
    assert saved(reports)["items"][1]["report_id"].startswith("BTC-USD_")


def test_crypto_with_only_fundamentals_fails_clearly(reports):
    write_batch(reports, ["BTC-USD"], analysts=("fundamentals",), auto_summarize=False)
    run_batch.run("20261005_101500_a1b2", graph_factory=FakeGraphs())
    item = saved(reports)["items"][0]
    assert item["status"] == "failed"
    assert "no selected analyst supports crypto" in item["error"]


def test_summary_failure_keeps_item_done(reports):
    write_batch(reports, ["NVDA"])

    def broken(_dir):
        raise RuntimeError("rate limited")

    run_batch.run("20261005_101500_a1b2", graph_factory=FakeGraphs(), summarizer=broken)
    batch = saved(reports)
    assert batch["status"] == "done"
    assert batch["items"][0]["summary_status"] == "failed"
    assert batch["items"][0]["error"] == "summary: RuntimeError: rate limited"


def test_cancel_marks_current_and_remaining_cancelled(reports):
    write_batch(reports, ["NVDA", "MSFT", "AAPL"], auto_summarize=False)
    run_batch.run("20261005_101500_a1b2", graph_factory=FakeGraphs(cancel_on="MSFT"))
    batch = saved(reports)
    assert batch["status"] == "cancelled"
    assert [i["status"] for i in batch["items"]] == ["done", "cancelled", "cancelled"]


def test_config_failure_fails_whole_batch(reports, monkeypatch):
    write_batch(reports, ["NVDA"])

    def boom():
        raise ValueError("Invalid value for TRADINGAGENTS_MAX_DEBATE_ROUNDS")

    monkeypatch.setattr(run_batch, "load_config", boom)
    run_batch.run("20261005_101500_a1b2", graph_factory=FakeGraphs())
    batch = saved(reports)
    assert batch["status"] == "failed"
    assert "TRADINGAGENTS_MAX_DEBATE_ROUNDS" in batch["error"]
    assert batch["items"][0]["status"] == "failed"


def test_writes_meta_json_with_trade_date(reports):
    write_batch(reports, ["NVDA", "BTCUSD"], auto_summarize=False)
    run_batch.run("20261005_101500_a1b2", graph_factory=FakeGraphs())
    items = saved(reports)["items"]
    nvda = json.loads((reports / items[0]["report_id"] / "meta.json").read_text())
    btc = json.loads((reports / items[1]["report_id"] / "meta.json").read_text())
    assert nvda == {"ticker": "NVDA", "trade_date": "2026-10-03", "asset_type": "stock",
                    "analysts": ["market", "news", "fundamentals"], "batch_id": "20261005_101500_a1b2"}
    assert btc["ticker"] == "BTC-USD" and btc["asset_type"] == "crypto" and btc["analysts"] == ["market", "news"]


def test_second_sigterm_while_unwinding_is_ignored():
    import signal

    previous = signal.signal(signal.SIGTERM, run_batch._raise_cancelled)
    try:
        with pytest.raises(run_batch.Cancelled):
            run_batch._raise_cancelled(signal.SIGTERM, None)
        assert signal.getsignal(signal.SIGTERM) == signal.SIG_IGN
    finally:
        signal.signal(signal.SIGTERM, previous)


SLOW_WORKER = """
import sys, time
from dashboard.worker import run_batch

class SlowGraph:
    def propagate(self, ticker, date, asset_type):
        print("STARTED", flush=True)
        time.sleep(30)

run_batch._default_graph_factory = lambda analysts, config: SlowGraph()
run_batch.load_config = lambda: {"max_debate_rounds": 1, "max_risk_discuss_rounds": 1}
sys.exit(run_batch.main([sys.argv[1]]))
"""


def test_sigterm_mid_ticker_cancels_a_real_worker_process(reports):
    import os
    import signal
    import subprocess
    import sys
    from pathlib import Path

    write_batch(reports, ["NVDA", "MSFT"], auto_summarize=False)
    repo = Path(run_batch.__file__).resolve().parents[2]
    proc = subprocess.Popen(
        [sys.executable, "-c", SLOW_WORKER, "20261005_101500_a1b2"],
        cwd=repo, env={**os.environ, "TA_REPORTS_DIR": str(reports)},
        stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True,
    )
    try:
        assert proc.stdout.readline().strip() == "STARTED"  # first ticker is mid-analysis
        proc.send_signal(signal.SIGTERM)
        assert proc.wait(timeout=20) == 0
    finally:
        proc.kill()
    batch = saved(reports)
    assert batch["status"] == "cancelled"
    assert [i["status"] for i in batch["items"]] == ["cancelled", "cancelled"]
