import json

import pytest

from dashboard.worker import batch_store
from dashboard.worker.common import resolve_report_dir


@pytest.fixture(autouse=True)
def reports(tmp_path, monkeypatch):
    monkeypatch.setenv("TA_REPORTS_DIR", str(tmp_path))
    return tmp_path


def make_batch(reports, statuses):
    batch = {
        "id": "20261005_101500_a1b2",
        "created_at": "2026-10-05T10:15:00Z",
        "updated_at": "2026-10-05T10:15:00Z",
        "status": "queued",
        "pid": None,
        "error": None,
        "params": {"tickers": [f"T{i}" for i in range(len(statuses))]},
        "items": [
            {"ticker": f"T{i}", "status": s, "started_at": None, "finished_at": None,
             "report_id": None, "signal": None, "summary_status": "none", "error": None}
            for i, s in enumerate(statuses)
        ],
    }
    (reports / "_batches").mkdir(exist_ok=True)
    (reports / "_batches" / f"{batch['id']}.json").write_text(json.dumps(batch))
    return batch


def test_load_save_roundtrip_is_atomic(reports):
    make_batch(reports, ["pending"])
    batch = batch_store.load("20261005_101500_a1b2")
    batch_store.mark_item(batch, 0, status="running")
    on_disk = json.loads((reports / "_batches" / "20261005_101500_a1b2.json").read_text())
    assert on_disk["items"][0]["status"] == "running"
    assert on_disk["updated_at"] != "2026-10-05T10:15:00Z"
    assert not list((reports / "_batches").glob("*.tmp"))


def test_load_rejects_bad_ids():
    with pytest.raises(ValueError):
        batch_store.load("../../etc/passwd")


@pytest.mark.parametrize("statuses, expected", [
    (["done", "done"], "done"),
    (["done", "failed"], "partial"),
    (["failed", "failed"], "failed"),
])
def test_finalize_outcomes(reports, statuses, expected):
    batch = make_batch(reports, statuses)
    assert batch_store.finalize(batch)["status"] == expected


def test_finalize_marks_unrun_items_failed(reports):
    batch = make_batch(reports, ["done", "running", "pending"])
    batch_store.finalize(batch)
    assert [i["status"] for i in batch["items"]] == ["done", "failed", "failed"]
    assert batch["items"][2]["error"] == "worker stopped before this ticker finished"
    assert batch["status"] == "partial"


def test_finalize_cancelled(reports):
    batch = make_batch(reports, ["done", "running", "pending"])
    batch_store.finalize(batch, cancelled=True)
    assert [i["status"] for i in batch["items"]] == ["done", "cancelled", "cancelled"]
    assert batch["status"] == "cancelled"


def test_resolve_report_dir(reports):
    (reports / "SPY_20261004_220413").mkdir()
    assert resolve_report_dir("SPY_20261004_220413") == (reports / "SPY_20261004_220413").resolve()
    for bad in ["..", "../x", "_batches", "a/b", ""]:
        with pytest.raises(ValueError):
            resolve_report_dir(bad)
    with pytest.raises(FileNotFoundError):
        resolve_report_dir("NOPE_20261004_220413")
