"""Batch status files (reports/_batches/<id>.json) shared with the Next.js dashboard.

Only the run_batch worker writes a batch file after the API creates it, so
plain load/modify/save is race-free.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

from dashboard.worker.common import batches_dir, now_iso, write_json_atomic

_BATCH_ID_RE = re.compile(r"^\d{8}_\d{6}_[0-9a-f]{4}$")


def _path(batch_id: str) -> Path:
    if not _BATCH_ID_RE.fullmatch(batch_id or ""):
        raise ValueError(f"invalid batch id: {batch_id!r}")
    return batches_dir() / f"{batch_id}.json"


def load(batch_id: str) -> dict:
    return json.loads(_path(batch_id).read_text(encoding="utf-8"))


def save(batch: dict) -> None:
    batch["updated_at"] = now_iso()
    write_json_atomic(_path(batch["id"]), batch)


def mark_item(batch: dict, index: int, **fields) -> None:
    batch["items"][index].update(fields)
    save(batch)


def finalize(batch: dict, cancelled: bool = False) -> dict:
    """Close out unfinished items and set the batch's terminal status."""
    unfinished = ("pending", "running")
    for item in batch["items"]:
        if item["status"] in unfinished:
            if cancelled:
                item["status"] = "cancelled"
            else:
                item["status"] = "failed"
                item["error"] = item.get("error") or "worker stopped before this ticker finished"
    if cancelled:
        batch["status"] = "cancelled"
    else:
        done = sum(1 for i in batch["items"] if i["status"] == "done")
        if done == len(batch["items"]):
            batch["status"] = "done"
        else:
            batch["status"] = "partial" if done else "failed"
    save(batch)
    return batch
