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
