# TradingAgents Dashboard

A local web UI for TradingAgents: browse saved reports, run analyses for several tickers as one batch, and get LLM summaries with a per-batch comparison table.

## Setup

Requires the repo's Python environment (`.venv` with `tradingagents` installed) and your provider settings in the repo `.env` (the same ones the CLI uses: `TRADINGAGENTS_LLM_PROVIDER`, `TRADINGAGENTS_QUICK_THINK_LLM`, API keys, ...).

```bash
cd dashboard
pnpm install
pnpm dev          # http://127.0.0.1:3000
```

The server binds to `127.0.0.1` only, and the endpoints that start batches, run summaries or cancel only accept requests from the dashboard itself (localhost `Host`/`Origin`, no cross-site requests). There is no login, so keep it that way: don't expose it on your network.

Optional env vars (see `.env.example`): `TA_REPO_ROOT`, `TA_PYTHON` (default `../.venv/bin/python`), `TA_REPORTS_DIR` (default `../reports`).

## How it works

- Reports are read from `reports/<TICKER>_<YYYYMMDD_HHMMSS>/`, the same folders the CLI writes.
- **New batch** starts `python -m dashboard.worker.run_batch <id>` in the background. It runs the tickers one after another and records progress in `reports/_batches/<id>.json` (log: `<id>.log`). Only one batch runs at a time; closing the browser or restarting the dev server doesn't stop it. **Cancel** sends it SIGTERM.
- **Summaries** come from your configured quick-think model and are saved as `summary.json` in each report folder. The batch page's comparison table is built from those files.

## Tests

```bash
pnpm test                                                        # TypeScript (vitest)
cd .. && .venv/bin/python -m pytest dashboard/worker/tests -q    # Python worker
```
