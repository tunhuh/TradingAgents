import json
import os
from types import SimpleNamespace

import pytest

from dashboard.worker import summarize
from dashboard.worker.schemas import ReportSummary
from dashboard.worker.summarize import SummaryError, summarize_report

GOOD = {
    "rating": "Overweight", "price_target": 785.0, "stop_loss": 758.0,
    "time_horizon": "3-6 months", "tldr": "Add on dips.",
    "bull_points": ["a"], "key_risks": ["b"], "catalysts_to_watch": ["c"],
}


class FakeLLM:
    """structured: ReportSummary | dict | Exception | None; text: str reply for plain invoke."""

    def __init__(self, structured=None, text=None, bind_error=None):
        self.structured, self.text, self.bind_error = structured, text, bind_error
        self.plain_calls = []

    def with_structured_output(self, schema):
        if self.bind_error:
            raise self.bind_error
        outer = self

        class _S:
            def invoke(self, messages):
                if isinstance(outer.structured, Exception):
                    raise outer.structured
                return outer.structured

        return _S()

    def invoke(self, messages):
        self.plain_calls.append(messages)
        return SimpleNamespace(content=self.text)


@pytest.fixture
def report(tmp_path):
    d = tmp_path / "SPY_20261004_220413"
    d.mkdir()
    (d / "complete_report.md").write_text("# Trading Analysis Report: SPY\n...")
    return d


def test_structured_success_writes_summary(report):
    data = summarize_report(report, FakeLLM(structured=ReportSummary(**GOOD)), "openai/gpt-x")
    on_disk = json.loads((report / "summary.json").read_text())
    assert on_disk == data
    assert data["rating"] == "Overweight"
    assert data["model"] == "openai/gpt-x"
    assert data["source_mtime"] == os.stat(report / "complete_report.md").st_mtime
    assert data["generated_at"].endswith("Z")


def test_structured_dict_result_is_validated(report):
    data = summarize_report(report, FakeLLM(structured=dict(GOOD)), "m")
    assert data["price_target"] == 785.0


def test_falls_back_to_fenced_json_when_structured_fails(report):
    reply = "```json\n" + json.dumps(GOOD) + "\n```"
    llm = FakeLLM(structured=RuntimeError("tool call refused"), text=reply)
    data = summarize_report(report, llm, "m")
    assert data["rating"] == "Overweight"
    assert len(llm.plain_calls) == 1
    assert "JSON" in llm.plain_calls[0][0][1]


def test_falls_back_when_binding_unsupported_or_result_none(report):
    for llm in (FakeLLM(bind_error=NotImplementedError(), text=json.dumps(GOOD)),
                FakeLLM(structured=None, text="Sure! " + json.dumps(GOOD) + " Hope that helps.")):
        assert summarize_report(report, llm, "m")["tldr"] == "Add on dips."


def test_normalizes_loose_llm_values(report):
    loose = dict(GOOD, rating=" buy ", price_target="$1,234.50", stop_loss="15%",
                 bull_points=["1", "2", " ", "3", "4"], key_risks=["  r  "])
    data = summarize_report(report, FakeLLM(structured=RuntimeError(), text=json.dumps(loose)), "m")
    assert data["rating"] == "Buy"
    assert data["price_target"] == 1234.5
    assert data["stop_loss"] is None
    assert data["bull_points"] == ["1", "2", "3"]
    assert data["key_risks"] == ["r"]


def test_unparseable_reply_raises_and_writes_nothing(report):
    with pytest.raises(SummaryError):
        summarize_report(report, FakeLLM(structured=RuntimeError(), text="no idea"), "m")
    with pytest.raises(SummaryError):
        summarize_report(report, FakeLLM(structured=RuntimeError(), text='{"rating": "Maybe"}'), "m")
    assert not (report / "summary.json").exists()


def test_missing_complete_report(tmp_path):
    with pytest.raises(SummaryError, match="complete_report.md"):
        summarize_report(tmp_path, FakeLLM(structured=ReportSummary(**GOOD)), "m")


def test_cli_reports_errors_on_stderr(tmp_path, monkeypatch, capsys):
    monkeypatch.setenv("TA_REPORTS_DIR", str(tmp_path))
    assert summarize.main(["../etc"]) == 1
    assert "invalid report id" in capsys.readouterr().err
    assert summarize.main([]) == 2


def test_list_fields_accept_null_and_single_string(report):
    loose = dict(GOOD, key_risks=None, bull_points="Only one point", catalysts_to_watch=None)
    data = summarize_report(report, FakeLLM(structured=RuntimeError(), text=json.dumps(loose)), "m")
    assert data["key_risks"] == []
    assert data["bull_points"] == ["Only one point"]
    assert data["catalysts_to_watch"] == []
