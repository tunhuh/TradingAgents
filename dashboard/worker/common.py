"""Paths, ids and config shared by the dashboard's Python workers.

Workers are launched by the Next.js app with cwd = repo root, so importing
``tradingagents`` loads the repo ``.env`` (see tradingagents/__init__.py)
before DEFAULT_CONFIG is built.
"""

from __future__ import annotations

import copy
import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]

# One path segment (custom CLI save paths may contain spaces etc.). A leading
# "_" or "." excludes internal folders like _batches, hidden dirs, and "..".
_REPORT_ID_RE = re.compile(r"^[^_./\\\x00][^/\\\x00]*$")


def reports_dir() -> Path:
    return Path(os.environ.get("TA_REPORTS_DIR") or REPO_ROOT / "reports")


def batches_dir() -> Path:
    return reports_dir() / "_batches"


def resolve_report_dir(report_id: str) -> Path:
    """Return the report folder for ``report_id``; reject anything outside reports_dir()."""
    if not _REPORT_ID_RE.fullmatch(report_id or ""):
        raise ValueError(f"invalid report id: {report_id!r}")
    base = reports_dir().resolve()
    path = (base / report_id).resolve()
    if path.parent != base:
        raise ValueError(f"invalid report id: {report_id!r}")
    if not path.is_dir():
        raise FileNotFoundError(f"no such report: {report_id}")
    return path


def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def write_json_atomic(path: Path, data) -> None:
    """Write JSON via a temp file + rename so readers never see a partial file."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps(data, indent=2), encoding="utf-8")
    os.replace(tmp, path)


def load_config() -> dict:
    from tradingagents.default_config import DEFAULT_CONFIG

    return copy.deepcopy(DEFAULT_CONFIG)
