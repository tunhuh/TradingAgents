# TradingAgents Dashboard — Design

Date: 2026-10-05
Status: Approved (design), pending spec review

## Purpose

A local, single-user Next.js web dashboard (new `dashboard/` subfolder) for the
TradingAgents framework that lets the user:

1. Browse the saved analysis reports under `reports/`.
2. Start an analysis for **multiple tickers in one batch** and follow its progress.
3. Get an **LLM-written summary** of each report, and a **cross-ticker comparison
   table** for each batch.

Non-goals: authentication, multi-user use, cloud deployment, per-agent live
streaming, live price data, changes to the `tradingagents/` package.

## Context (existing repo facts)

- Reports are written by `tradingagents.reporting.write_report_tree` to
  `reports/<TICKER>_<YYYYMMDD_HHMMSS>/` (CLI default) with:
  `complete_report.md`, `1_analysts/{market,sentiment,news,fundamentals}.md`,
  `2_research/{bull,bear,manager}.md`, `3_trading/trader.md`,
  `4_risk/{aggressive,conservative,neutral}.md`, `5_portfolio/decision.md`.
  Any of these may be missing (e.g. analysts not selected).
- `reports/` is gitignored.
- Runs are driven by `TradingAgentsGraph(selected_analysts, config).propagate(ticker, date, asset_type)`
  → `(final_state, signal)`; `save_reports(final_state, ticker, save_path)` writes the tree.
- `DEFAULT_CONFIG` already applies `TRADINGAGENTS_*` env overrides; the repo `.env`
  holds provider/model/API keys (loaded with `python-dotenv`).
- Asset type detection: `cli.utils.detect_asset_type(ticker)` (used by the CLI).
- LLM construction: `tradingagents.llm_clients.factory.create_llm_client(provider, model, base_url, **kwargs).get_llm()`.
- Analyst keys: `market`, `social`, `news`, `fundamentals`.
- Python env: `<repo>/.venv/bin/python` (Python 3.12). Node 22, pnpm 11 available.

## Architecture

```
Browser ──► Next.js (dashboard/, App Router, server components + route handlers)
               │  reads files directly           │ spawns detached child processes
               ▼                                  ▼
          reports/<id>/…                   <repo>/.venv/bin/python -m dashboard.worker.<cmd>
          reports/_batches/<bid>.json  ◄──  (run_batch writes status; summarize writes summary.json)
```

Next.js never imports Python and Python never talks HTTP; the filesystem is
the only interface. Workers run with `cwd = <repo root>` so `tradingagents`,
`cli`, and `dashboard.worker` (namespace package) are importable.

### Directory layout

```
dashboard/
  package.json, next.config.ts, tsconfig.json, postcss/tailwind config, components.json
  .env.example                 # TA_REPO_ROOT, TA_PYTHON
  app/
    layout.tsx                 # nav: Reports | Batches | New batch
    page.tsx                   # Reports list
    reports/[id]/page.tsx      # Report detail
    batches/page.tsx           # Batches list
    batches/new/page.tsx       # New batch form
    batches/[id]/page.tsx      # Batch detail + comparison table
    api/batches/route.ts               # GET list, POST create+launch
    api/batches/[id]/route.ts          # GET status, DELETE cancel
    api/reports/[id]/summary/route.ts  # POST (re)generate summary
  components/                  # ui (shadcn), SummaryCard, ComparisonTable, BatchStatus (client, polling), Markdown
  lib/
    paths.ts                   # repo root, reports dir, batches dir, python path; safe id resolution
    reports.ts                 # list/read reports + summaries
    batches.ts                 # read/list batches, isActive(), validation
    python.ts                  # spawnWorker(), runWorker() (await completion)
    types.ts                   # Report, ReportSummary, Batch, BatchItem
  worker/
    __init__.py
    schemas.py                 # ReportSummary pydantic model
    batch_store.py             # load/save batch JSON atomically, state transitions
    run_batch.py               # entry: python -m dashboard.worker.run_batch <batch_id>
    summarize.py               # entry: python -m dashboard.worker.summarize <report_id>
    tests/                     # pytest
```

### Configuration

- `TA_REPO_ROOT` — repo root; default: parent of `dashboard/` (`path.resolve(process.cwd(), "..")`).
- `TA_PYTHON` — interpreter; default `<repo>/.venv/bin/python`.
- LLM provider/model/keys: unchanged, from repo `.env` via `DEFAULT_CONFIG`.
  Workers call `load_dotenv(<repo>/.env)` before importing `tradingagents.default_config`.

## Data formats

### Batch file — `reports/_batches/<batch_id>.json`

`batch_id` = `YYYYMMDD_HHMMSS_<4 hex>`.

```json
{
  "id": "20261005_101500_a1b2",
  "created_at": "2026-10-05T10:15:00Z",
  "updated_at": "2026-10-05T10:31:02Z",
  "status": "queued | running | done | partial | failed | cancelled",
  "pid": 12345,
  "params": {
    "tickers": ["NVDA", "MSFT"],
    "trade_date": "2026-10-03",
    "analysts": ["market", "social", "news", "fundamentals"],
    "max_debate_rounds": 1,
    "max_risk_discuss_rounds": 1,
    "auto_summarize": true
  },
  "items": [
    {
      "ticker": "NVDA",
      "status": "pending | running | done | failed | cancelled",
      "started_at": null, "finished_at": null,
      "report_id": "NVDA_20261005_101502",
      "signal": "Buy",
      "summary_status": "none | done | failed",
      "error": null
    }
  ]
}
```

Writes are atomic (write `<file>.tmp`, then `os.replace`). Only the worker
writes a batch file after creation; the API writes it once at creation (and
on cancel only if the worker is already dead).

Final batch status: `done` if all items done; `partial` if ≥1 done and ≥1
failed; `failed` if none done; `cancelled` if cancelled by the user.

### Summary file — `reports/<report_id>/summary.json`

```json
{
  "rating": "Buy | Overweight | Hold | Underweight | Sell",
  "price_target": 785.0,
  "stop_loss": 758.0,
  "time_horizon": "3-6 months",
  "tldr": "≤3 sentences",
  "bull_points": ["≤3 items"],
  "key_risks": ["≤3 items"],
  "catalysts_to_watch": ["≤3 items"],
  "model": "provider/model-name",
  "generated_at": "ISO-8601",
  "source_mtime": 1759630000.0
}
```

`price_target`, `stop_loss`, `time_horizon` are nullable. The summary is
**stale** when `complete_report.md` mtime ≠ `source_mtime`; the UI shows a
"stale — regenerate" hint.

## Components

### Python worker

**`schemas.py`** — `ReportSummary(BaseModel)` with the fields above (minus
`model`/`generated_at`/`source_mtime`), `rating: PortfolioRating` reused from
`tradingagents.agents.schemas`, list fields capped at 3 (validator truncates),
numeric fields coerced with the same "nullish/percent → None" rule as the
repo's `_coerce_optional_float`.

**`batch_store.py`** — `load(batch_id)`, `save(batch)` (atomic),
`mark_item(batch, ticker_index, **fields)`, `finalize(batch)` (computes the
final status), `batches_dir()`. Pure functions over dicts; no LLM imports.

**`summarize.py`**
- `summarize_report(report_dir: Path, llm) -> dict`: reads
  `complete_report.md` (error if missing), builds a prompt (system: analyst
  summarizer instructions + repo `NO_EXTERNAL_TOOLS` constraint; user: report
  text), calls `llm.with_structured_output(ReportSummary)`. On exception or
  unsupported binding, falls back once to plain `llm.invoke` asking for JSON
  only, then parses with `ReportSummary.model_validate_json` after stripping
  code fences. Adds `model`, `generated_at`, `source_mtime`; writes
  `summary.json` atomically; returns the dict.
- `build_llm(config)`: quick-think model via `create_llm_client` with
  `backend_url` and the same provider kwargs the graph uses where applicable
  (retries, max_tokens, temperature).
- CLI entry: `python -m dashboard.worker.summarize <report_id>`; exits 0 on
  success, 1 with a one-line error on stderr otherwise.

**`run_batch.py`**
- Entry: `python -m dashboard.worker.run_batch <batch_id>`.
- Loads batch, sets `status=running`, `pid=os.getpid()`.
- Builds config: `DEFAULT_CONFIG.copy()` + `max_debate_rounds`,
  `max_risk_discuss_rounds` from params. Graphs are cached per analyst set
  (`dict[tuple[str, ...], TradingAgentsGraph]`) because the analyst set is
  fixed at graph construction; stocks and crypto may need different sets.
- For each item: `running` → `asset_type = cli.utils.detect_asset_type(ticker)`
  → analysts = `cli.utils.filter_analysts_for_asset_type(params.analysts, asset_type)`
  (crypto drops `fundamentals`; if the result is empty the item fails with a
  clear error) → cached graph for that set → `propagate(ticker, trade_date, asset_type=asset_type.value)` → `save_reports` to
  `reports/<SAFE_TICKER>_<stamp>` → `done` with `report_id` and `signal`
  → if `auto_summarize`, run `summarize_report` (failure only sets
  `summary_status=failed`, item stays `done`). Any exception in the run
  → item `failed` with `error = "<ExceptionType>: <msg>"` (truncated to 500 chars), continue.
- SIGTERM handler: sets a flag; the current ticker is abandoned, the current
  and remaining items become `cancelled`, batch `cancelled`, exit.
- `finally`: `finalize` + save.

### Next.js

**`lib/paths.ts`** — `resolveReportDir(id)`: id must match
`^[A-Za-z0-9.\-^=_]+$`, resolved path must stay inside `reports/`, and must
not start with `_`; otherwise throw `NotFound`. Same for batch ids
(`^\d{8}_\d{6}_[0-9a-f]{4}$`).

**`lib/reports.ts`** — `listReports()`: directories in `reports/` not
starting with `_`, parse `<TICKER>_<YYYYMMDD>_<HHMMSS>` from the name
(fallback: folder mtime, ticker = name), attach `summary.json` if present +
stale flag; sorted newest first. `getReport(id)`: the section files that
exist, grouped by step, + summary.

**`lib/batches.ts`** — `listBatches()`, `getBatch(id)`,
`isActive(batch)`: `status ∈ {queued, running}` and (pid unknown and created
< 2 min ago, or `process.kill(pid, 0)` succeeds). `validateParams(body)`:
1–20 tickers, each `^[A-Za-z0-9.\-^=]{1,32}$` (upper-cased, deduped);
`trade_date` `YYYY-MM-DD` not in the future; analysts ⊆ the four keys, ≥1;
rounds integer 1–5.

**`lib/python.ts`** — `spawnWorker(module, args, logFile)`: `child_process.spawn(TA_PYTHON, ["-m", module, ...args], { cwd: repoRoot, detached: true, stdio: ["ignore", log, log] })` then `unref()`; returns pid. `runWorker(module, args, timeoutMs)`: awaits exit, returns `{ code, stderr }`. Never uses a shell.

**API**
- `POST /api/batches` → validate → if any active batch: 409 `{ error, activeBatchId }` → write batch file (`queued`) → spawn `run_batch` with log `reports/_batches/<id>.log` → 201 `{ id }`.
- `GET /api/batches` → list; `GET /api/batches/[id]` → batch JSON (+ `active` flag).
- `DELETE /api/batches/[id]` → if active, `process.kill(pid, "SIGTERM")`; if the pid is dead but status is non-terminal, the API marks it `failed` ("worker exited unexpectedly"). 200.
- `POST /api/reports/[id]/summary` → `runWorker("dashboard.worker.summarize", [id], 180s)` → 200 with summary JSON, or 500 `{ error: stderr last line }`.

**Pages**
- `/` Reports list: table Ticker | Run time | Rating badge | Price target | Horizon | TL;DR (truncated) | action ("Summarize" button when no summary). Client-side filter by ticker text and date range.
- `/reports/[id]`: header (ticker, run time), SummaryCard (or "Summarize" button; "Regenerate" when present/stale), Tabs: Analysts / Research / Trading / Risk / Portfolio / Full report, each rendering markdown via `react-markdown` + `remark-gfm`. Tabs with no files are hidden.
- `/batches/new`: form (tickers textarea, date picker default today, analyst checkboxes all on, debate & risk rounds default 1, auto-summarize on). On 409, show link to the active batch. On success, redirect to `/batches/[id]`.
- `/batches/[id]`: params, per-ticker status list (badges, error text, report link), Cancel button while active, log tail (last 50 lines of `<id>.log`) collapsible; ComparisonTable of items with summaries: Ticker | Rating | Price target | Stop | Horizon | TL;DR, sorted by rating order Buy→Sell then ticker. Client component polls `GET /api/batches/[id]` every 3 s while active, then calls `router.refresh()` once on completion.
- `/batches`: table of batches: created, tickers, status, done/failed counts.

UI: Tailwind + shadcn/ui (Table, Badge, Button, Card, Tabs, Input, Checkbox), light/dark via system. Rating badge colors: Buy/Overweight green, Hold neutral, Underweight/Sell red, REVIEW amber.

## Error handling summary

| Failure | Behaviour |
|---|---|
| One ticker's run throws | item `failed` + error; batch continues |
| Summary fails in batch | item stays `done`, `summary_status=failed`; user can retry from report page |
| Worker crashes / killed | batch shows non-terminal status with dead pid → `isActive` false → UI shows "worker exited unexpectedly"; a new batch can start |
| Second batch while one active | 409 with link to active batch |
| Invalid ticker/date/id | 400 (API) / 404 (pages) |
| Missing report files | that tab hidden; missing `complete_report.md` → summarize returns error |
| Python not found | spawn error → 500 with message naming `TA_PYTHON` |

## Testing

- **pytest** (`dashboard/worker/tests/`, run from repo root):
  `batch_store` transitions and `finalize` outcomes; `summarize_report` with a
  fake LLM (structured success, structured failure → JSON fallback, bad
  output → error), list truncation and nullish coercion; `run_batch` loop with
  a monkeypatched `TradingAgentsGraph` (success, one failing ticker → partial,
  auto-summarize failure keeps item done). No network.
- **vitest** (`dashboard/`): report folder-name parsing, `resolveReportDir`
  rejects traversal (`..`, `/`, `_batches`), `validateParams`, `isActive`
  with dead/alive pid, comparison sort order.
- **Manual E2E**: start dev server, run a 1-ticker batch with a cheap model,
  observe status → report → summary → comparison table.

## Out of scope / possible follow-ups

Per-agent live progress, current-price upside column, concurrent batches /
job queue, auth, deployment, editing LLM provider from the UI.
