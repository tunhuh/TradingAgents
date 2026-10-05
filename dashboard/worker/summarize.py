"""LLM summary of one saved report, written to reports/<report_id>/summary.json.

Usage: python -m dashboard.worker.summarize <report_id>
"""

from __future__ import annotations

import logging
import sys
from pathlib import Path

from pydantic import ValidationError

from dashboard.worker.common import load_config, now_iso, resolve_report_dir, write_json_atomic
from dashboard.worker.schemas import ReportSummary
from tradingagents.agents.structured import NO_EXTERNAL_TOOLS
from tradingagents.llm_clients.base_client import normalize_content

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = (
    "You summarize equity research reports produced by a multi-agent trading desk "
    "(analysts, bull/bear researchers, trader, risk team, portfolio manager).\n"
    "Report the Portfolio Manager's FINAL decision (section V), not the intermediate "
    "views of individual analysts or debaters.\n"
    "- price_target / stop_loss: absolute price levels from the final decision or the "
    "trader's plan; null if not stated.\n"
    "- tldr: at most 3 sentences for a busy portfolio manager.\n"
    "- bull_points, key_risks, catalysts_to_watch: up to 3 short items each; keep the "
    "report's concrete numbers, dates and levels.\n"
    + NO_EXTERNAL_TOOLS
)

JSON_ONLY = (
    "\n\nRespond with one JSON object with exactly these keys: rating, price_target, "
    "stop_loss, time_horizon, tldr, bull_points, key_risks, catalysts_to_watch. "
    "No prose and no code fences."
)


class SummaryError(RuntimeError):
    """The report could not be summarized."""


def _messages(report_text: str, extra: str = "") -> list[tuple[str, str]]:
    return [("system", SYSTEM_PROMPT + extra), ("human", report_text)]


def _parse_json_reply(text: str) -> ReportSummary:
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end < start:
        raise SummaryError("model reply contained no JSON object")
    try:
        return ReportSummary.model_validate_json(text[start : end + 1])
    except ValidationError as exc:
        raise SummaryError(
            f"model reply did not match the summary schema ({exc.error_count()} error(s))"
        ) from exc


def _structured_summary(llm, report_text: str) -> ReportSummary | None:
    try:
        result = llm.with_structured_output(ReportSummary).invoke(_messages(report_text))
        if isinstance(result, ReportSummary):
            return result
        if isinstance(result, dict):
            return ReportSummary.model_validate(result)
        raise ValueError("structured output returned no parsed result")
    except Exception as exc:  # any provider/parse failure → one free-text JSON retry
        logger.warning("structured summary failed (%s); retrying as JSON text", exc)
        return None


def summarize_report(report_dir: Path, llm, model_label: str) -> dict:
    report_file = report_dir / "complete_report.md"
    if not report_file.is_file():
        raise SummaryError(f"no complete_report.md in {report_dir.name}")
    report_text = report_file.read_text(encoding="utf-8")

    summary = _structured_summary(llm, report_text)
    if summary is None:
        reply = normalize_content(llm.invoke(_messages(report_text, JSON_ONLY)))
        summary = _parse_json_reply(str(reply.content or ""))

    data = summary.model_dump(mode="json")
    data.update(model=model_label, generated_at=now_iso(), source_mtime=report_file.stat().st_mtime)
    write_json_atomic(report_dir / "summary.json", data)
    return data


def build_llm(config: dict):
    """Quick-think model of the configured provider; returns (llm, "provider/model")."""
    from tradingagents.llm_clients import create_tier_client, tier_provider

    # The same quick-tier client the graph builds: its provider, endpoint and
    # provider settings (effort, temperature, retries, token cap).
    llm = create_tier_client(config, "quick").get_llm()
    return llm, f"{tier_provider(config, 'quick')}/{config['quick_think_llm']}"


def main(argv: list[str] | None = None) -> int:
    args = sys.argv[1:] if argv is None else argv
    if len(args) != 1:
        print("usage: python -m dashboard.worker.summarize <report_id>", file=sys.stderr)
        return 2
    try:
        report_dir = resolve_report_dir(args[0])
        llm, label = build_llm(load_config())
        summarize_report(report_dir, llm, label)
    except Exception as exc:
        print(f"{type(exc).__name__}: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
