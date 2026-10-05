# TradingAgents Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A local Next.js dashboard in `dashboard/` that lists/reads TradingAgents reports, starts multi-ticker analysis batches, and produces LLM summaries plus a per-batch comparison table.

**Architecture:** Next.js (App Router) reads `reports/` from disk in server components and spawns detached Python worker processes (`python -m dashboard.worker.run_batch|summarize`, cwd = repo root, interpreter = `.venv/bin/python`). The filesystem is the only interface: workers write `reports/_batches/<id>.json` (batch status) and `reports/<report_id>/summary.json`; the UI re-reads them, refreshing every 3 s while a batch is active.

**Tech Stack:** Next.js 16 (App Router, TypeScript), Tailwind v4, shadcn/ui, react-markdown + remark-gfm, @tailwindcss/typography, vitest; Python 3.12 (repo `.venv`), pydantic, pytest; existing `tradingagents` + `cli` packages.

**Spec:** `docs/superpowers/specs/2026-10-05-dashboard-design.md`

## Global Constraints

- No changes under `tradingagents/` or `cli/`; the dashboard only imports them.
- No new Python runtime dependencies (pytest is dev-only, already declared in `pyproject.toml` `[dev]`).
- Python worker modules live in `dashboard/worker/`, are run as `python -m dashboard.worker.<name>` with cwd = repo root (`dashboard` is a namespace package — do NOT add `dashboard/__init__.py`).
- Child processes are spawned with an argument array, never through a shell.
- Paths: `TA_REPO_ROOT` (default: parent of `dashboard/`), `TA_PYTHON` (default `<repo>/.venv/bin/python`), `TA_REPORTS_DIR` (default `<repo>/reports`; also passed to every worker).
- Batch id: `^\d{8}_\d{6}_[0-9a-f]{4}$`. Report id: `^[A-Za-z0-9.\-^=+][A-Za-z0-9._\-^=+]*$`, not all dots, must resolve directly inside the reports dir (so `_batches` and traversal are rejected).
- Ticker (API, after upper-casing): `^[A-Z0-9.\-^=]{1,32}$`, 1–20 per batch, deduped.
- Trade date `YYYY-MM-DD`, valid calendar date, not in the future. Analysts ⊆ `market, social, news, fundamentals`, ≥1. Debate/risk rounds integers 1–5 (default 1). `auto_summarize` default true.
- Only one active batch at a time (409 otherwise).
- Batch file statuses: batch `queued|running|done|partial|failed|cancelled`; item `pending|running|done|failed|cancelled`; `summary_status` `none|done|failed`. Writes are atomic (`.tmp` + rename).
- Summary fields: `rating` (Buy/Overweight/Hold/Underweight/Sell), `price_target`, `stop_loss` (nullable floats), `time_horizon` (nullable str), `tldr`, `bull_points`, `key_risks`, `catalysts_to_watch` (≤3 each) + `model`, `generated_at`, `source_mtime`.
- Summaries use the **quick-think** model of the configured provider.
- Rating sort order for the comparison table: Buy, Overweight, Hold, Underweight, Sell, then anything else; ties by ticker.

## Review Focus

1. Ticker text typed loosely (`"nvda, MSFT\nnvda ;btc-usd"`) → becomes `["NVDA","MSFT","BTC-USD"]`, not an error. Pinned in Task 5.
2. A corrupt or half-written `summary.json` / batch JSON → the list pages still render (summary treated as absent, bad batch skipped). Pinned in Tasks 1 and 5.
3. Worker process died while its batch file says `running` → batch is not "active", a new batch can start, DELETE marks it `failed`. Pinned in Task 5 (`isActive`) and smoke-tested in Task 6.
4. Report folders that don't follow `<TICKER>_<YYYYMMDD>_<HHMMSS>` (custom CLI save paths) → still listed, ticker = folder name, time = folder mtime. Pinned in Task 1.
5. LLM summary replies that are fenced JSON, lowercase rating, `"15%"` price, or >3 bullets → normalized summary instead of a failure. Pinned in Task 3. (Also: a crypto ticker with only `fundamentals` selected fails that item clearly — Task 4.)

---

## File Structure

```
dashboard/
  package.json, next.config.ts, tsconfig.json, components.json, vitest.config.ts, .env.example, README.md
  app/
    layout.tsx, globals.css
    page.tsx                          # Reports list
    reports/[id]/page.tsx             # Report detail
    batches/page.tsx                  # Batches list
    batches/new/page.tsx              # New batch form
    batches/[id]/page.tsx             # Batch detail + comparison
    api/batches/route.ts              # GET list / POST create
    api/batches/[id]/route.ts         # GET status / DELETE cancel
    api/reports/[id]/summary/route.ts # POST summarize
  components/
    ui/*                              # shadcn generated
    nav.tsx, rating-badge.tsx, markdown.tsx, summary-card.tsx, summarize-button.tsx,
    reports-table.tsx, comparison-table.tsx, auto-refresh.tsx, cancel-batch-button.tsx, new-batch-form.tsx
  lib/
    types.ts      # shared TS types + constants (pure, client-safe)
    format.ts     # formatting + todayLocal (pure, client-safe)
    compare.ts    # comparison sort (pure)
    paths.ts      # env-derived paths + id resolution (server)
    reports.ts    # report/summaries readers (server)
    batches.ts    # batch validation/IO/activity (server)
    python.ts     # spawnWorker / runWorker (server)
  lib/__tests__/*.test.ts
  worker/
    __init__.py
    common.py      # repo/report paths, id resolution, atomic JSON, now_iso, load_config
    batch_store.py # batch file load/save/mark/finalize
    schemas.py     # ReportSummary
    summarize.py   # summarize_report, build_llm, CLI
    run_batch.py   # run(), CLI
    tests/__init__.py, test_batch_store.py, test_summarize.py, test_run_batch.py
```

---

### Task 1: Next.js scaffold + report readers

**Files:**
- Create: `dashboard/` (via create-next-app), `dashboard/vitest.config.ts`, `dashboard/.env.example`
- Create: `dashboard/lib/types.ts`, `dashboard/lib/format.ts`, `dashboard/lib/paths.ts`, `dashboard/lib/reports.ts`
- Test: `dashboard/lib/__tests__/paths.test.ts`, `dashboard/lib/__tests__/reports.test.ts`

**Interfaces:**
- Produces (TS): types `Rating, RATINGS, ReportSummary, ReportListItem, ReportSection, ReportStep, ReportDetail, Analyst, ANALYSTS, BatchParams, BatchItem, Batch, BatchStatus, ItemStatus`; `NotFoundError`; `repoRoot(), reportsDir(), batchesDir(), pythonBin(): string`; `resolveReportDir(id): string`; `resolveBatchFile(id): string`; `BATCH_ID_RE`; `parseReportFolderName(name): {ticker: string; runAt: string|null}`; `readSummary(dir): Promise<{summary: ReportSummary|null; stale: boolean}>`; `readSummaryForReport(id): Promise<ReportSummary|null>`; `listReports(): Promise<ReportListItem[]>`; `getReport(id): Promise<ReportDetail>`; `formatPrice(n)`, `formatRunAt(s)`, `toLocalNaive(d)`, `todayLocal()`.

- [ ] **Step 1: Scaffold the app (must happen before anything else is put in `dashboard/`)**

```bash
cd /home/tuan/Desktop/projects/TradingAgents
pnpm create next-app@latest dashboard --ts --tailwind --eslint --app --no-src-dir --import-alias "@/*" --use-pnpm --yes
cd dashboard
pnpm add react-markdown remark-gfm
pnpm add -D vitest @tailwindcss/typography
pnpm dlx shadcn@latest init --yes --base-color neutral
pnpm dlx shadcn@latest add table badge button card tabs input checkbox label textarea
```

If a flag is rejected by the current CLI version, run the interactive prompt and pick: TypeScript yes, ESLint yes, Tailwind yes, `src/` no, App Router yes, import alias `@/*`, React Compiler no. For shadcn pick base colour Neutral.

Add to `dashboard/package.json` `"scripts"`: `"test": "vitest run"`.

Add to `dashboard/app/globals.css` directly after the `@import "tailwindcss";` line:

```css
@plugin "@tailwindcss/typography";
```

- [ ] **Step 2: Add vitest config and env example**

`dashboard/vitest.config.ts`:

```ts
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  test: { environment: "node", include: ["lib/**/*.test.ts"] },
});
```

`dashboard/.env.example`:

```bash
# All optional. Defaults assume dashboard/ sits inside the TradingAgents repo.
# TA_REPO_ROOT=/path/to/TradingAgents
# TA_PYTHON=/path/to/TradingAgents/.venv/bin/python
# TA_REPORTS_DIR=/path/to/TradingAgents/reports
```

- [ ] **Step 3: Write shared types and pure helpers**

`dashboard/lib/types.ts`:

```ts
export const RATINGS = ["Buy", "Overweight", "Hold", "Underweight", "Sell"] as const;
export type Rating = (typeof RATINGS)[number];

export const ANALYSTS = ["market", "social", "news", "fundamentals"] as const;
export type Analyst = (typeof ANALYSTS)[number];
export const ANALYST_LABELS: Record<Analyst, string> = {
  market: "Market",
  social: "Sentiment",
  news: "News",
  fundamentals: "Fundamentals",
};

export interface ReportSummary {
  rating: Rating;
  price_target: number | null;
  stop_loss: number | null;
  time_horizon: string | null;
  tldr: string;
  bull_points: string[];
  key_risks: string[];
  catalysts_to_watch: string[];
  model: string;
  generated_at: string;
  source_mtime: number;
}

export interface ReportListItem {
  id: string;
  ticker: string;
  /** Local wall-clock time, "YYYY-MM-DDTHH:MM:SS" (no zone). */
  runAt: string;
  summary: ReportSummary | null;
  summaryStale: boolean;
}

export interface ReportSection {
  key: string;
  title: string;
  markdown: string;
}

export type StepKey = "analysts" | "research" | "trading" | "risk" | "portfolio";

export interface ReportStep {
  key: StepKey;
  title: string;
  sections: ReportSection[];
}

export interface ReportDetail extends ReportListItem {
  steps: ReportStep[];
  complete: string | null;
}

export type BatchStatus = "queued" | "running" | "done" | "partial" | "failed" | "cancelled";
export type ItemStatus = "pending" | "running" | "done" | "failed" | "cancelled";

export interface BatchParams {
  tickers: string[];
  trade_date: string;
  analysts: Analyst[];
  max_debate_rounds: number;
  max_risk_discuss_rounds: number;
  auto_summarize: boolean;
}

export interface BatchItem {
  ticker: string;
  status: ItemStatus;
  started_at: string | null;
  finished_at: string | null;
  report_id: string | null;
  signal: string | null;
  summary_status: "none" | "done" | "failed";
  error: string | null;
}

export interface Batch {
  id: string;
  created_at: string;
  updated_at: string;
  status: BatchStatus;
  pid: number | null;
  error: string | null;
  params: BatchParams;
  items: BatchItem[];
}
```

`dashboard/lib/format.ts`:

```ts
const pad = (n: number) => String(n).padStart(2, "0");

/** Local wall-clock "YYYY-MM-DDTHH:MM:SS" — same shape as times parsed from report folder names. */
export function toLocalNaive(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function todayLocal(d: Date = new Date()): string {
  return toLocalNaive(d).slice(0, 10);
}

export function formatRunAt(runAt: string): string {
  return runAt.replace("T", " ").slice(0, 16);
}

export function formatPrice(n: number | null | undefined): string {
  return n == null ? "—" : n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

export function formatIso(iso: string | null | undefined): string {
  return iso ? toLocalNaive(new Date(iso)).replace("T", " ") : "—";
}
```

- [ ] **Step 4: Write the failing tests**

`dashboard/lib/__tests__/paths.test.ts`:

```ts
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { NotFoundError, resolveBatchFile, resolveReportDir } from "@/lib/paths";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "ta-paths-"));
  process.env.TA_REPORTS_DIR = dir;
});

describe("resolveReportDir", () => {
  it("resolves a normal report id inside the reports dir", () => {
    expect(resolveReportDir("SPY_20261004_220413")).toBe(path.join(dir, "SPY_20261004_220413"));
    expect(resolveReportDir("^GSPC_20261004_220413")).toBe(path.join(dir, "^GSPC_20261004_220413"));
  });

  it.each(["..", ".", "../etc", "a/b", "_batches", "", "a\\b", "x/../../y"])("rejects %j", (id) => {
    expect(() => resolveReportDir(id)).toThrow(NotFoundError);
  });
});

describe("resolveBatchFile", () => {
  it("accepts a well-formed id", () => {
    expect(resolveBatchFile("20261005_101500_a1b2")).toBe(path.join(dir, "_batches", "20261005_101500_a1b2.json"));
  });
  it.each(["../x", "20261005_101500", "20261005_101500_ZZZZ"])("rejects %j", (id) => {
    expect(() => resolveBatchFile(id)).toThrow(NotFoundError);
  });
});
```

`dashboard/lib/__tests__/reports.test.ts`:

```ts
import { mkdirSync, mkdtempSync, statSync, utimesSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { NotFoundError } from "@/lib/paths";
import { getReport, listReports, parseReportFolderName } from "@/lib/reports";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "ta-reports-"));
  process.env.TA_REPORTS_DIR = dir;
});

function makeReport(id: string, files: Record<string, string> = {}) {
  const root = path.join(dir, id);
  mkdirSync(root, { recursive: true });
  writeFileSync(path.join(root, "complete_report.md"), "# Trading Analysis Report");
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), text);
  }
  return root;
}

const summary = (sourceMtime: number) => ({
  rating: "Hold", price_target: 785, stop_loss: 758, time_horizon: "3-6 months",
  tldr: "Hold.", bull_points: [], key_risks: [], catalysts_to_watch: [],
  model: "openai/x", generated_at: "2026-10-05T00:00:00Z", source_mtime: sourceMtime,
});

describe("parseReportFolderName", () => {
  it("parses CLI-style names, including tickers with dashes, dots and underscores", () => {
    expect(parseReportFolderName("SPY_20261004_220413")).toEqual({ ticker: "SPY", runAt: "2026-10-04T22:04:13" });
    expect(parseReportFolderName("BTC-USD_20261004_220413").ticker).toBe("BTC-USD");
    expect(parseReportFolderName("BRK.B_20261004_220413").ticker).toBe("BRK.B");
  });
  it("falls back to the raw name when the pattern does not match", () => {
    expect(parseReportFolderName("my_custom_run")).toEqual({ ticker: "my_custom_run", runAt: null });
  });
});

describe("listReports", () => {
  it("returns [] when the reports dir does not exist", async () => {
    process.env.TA_REPORTS_DIR = path.join(dir, "missing");
    expect(await listReports()).toEqual([]);
  });

  it("skips _batches, sorts newest first, and lists non-standard folders by mtime", async () => {
    makeReport("SPY_20261004_220413");
    makeReport("GOOGL_20260918_230822");
    const custom = makeReport("my_custom_run");
    const when = new Date(2026, 8, 1, 10, 0, 0);
    utimesSync(custom, when, when);
    mkdirSync(path.join(dir, "_batches"));

    const ids = (await listReports()).map((r) => r.id);
    expect(ids).toEqual(["SPY_20261004_220413", "GOOGL_20260918_230822", "my_custom_run"]);
    const customItem = (await listReports()).find((r) => r.id === "my_custom_run")!;
    expect(customItem.ticker).toBe("my_custom_run");
    expect(customItem.runAt).toBe("2026-09-01T10:00:00");
  });

  it("attaches a valid summary, flags it stale when the report changes, and ignores corrupt JSON", async () => {
    const good = makeReport("SPY_20261004_220413");
    const mtime = statSync(path.join(good, "complete_report.md")).mtimeMs / 1000;
    writeFileSync(path.join(good, "summary.json"), JSON.stringify(summary(mtime)));
    const bad = makeReport("TSM_20260917_231550");
    writeFileSync(path.join(bad, "summary.json"), '{"rating": "Ho');

    let items = await listReports();
    expect(items.find((r) => r.id === "SPY_20261004_220413")!.summary?.rating).toBe("Hold");
    expect(items.find((r) => r.id === "SPY_20261004_220413")!.summaryStale).toBe(false);
    expect(items.find((r) => r.id === "TSM_20260917_231550")!.summary).toBeNull();

    const later = new Date(Date.now() + 60_000);
    utimesSync(path.join(good, "complete_report.md"), later, later);
    items = await listReports();
    expect(items.find((r) => r.id === "SPY_20261004_220413")!.summaryStale).toBe(true);
  });
});

describe("getReport", () => {
  it("returns only the steps and sections that exist, in pipeline order", async () => {
    makeReport("SPY_20261004_220413", {
      "1_analysts/news.md": "news text",
      "1_analysts/market.md": "market text",
      "5_portfolio/decision.md": "**Rating**: Hold",
    });
    const report = await getReport("SPY_20261004_220413");
    expect(report.steps.map((s) => s.key)).toEqual(["analysts", "portfolio"]);
    expect(report.steps[0].sections.map((s) => s.key)).toEqual(["market", "news"]);
    expect(report.steps[1].sections[0]).toEqual({ key: "decision", title: "Portfolio Manager", markdown: "**Rating**: Hold" });
    expect(report.complete).toContain("Trading Analysis Report");
  });

  it("throws NotFoundError for missing reports and traversal attempts", async () => {
    await expect(getReport("NOPE_20261004_220413")).rejects.toThrow(NotFoundError);
    await expect(getReport("../etc")).rejects.toThrow(NotFoundError);
    await expect(getReport("_batches")).rejects.toThrow(NotFoundError);
  });
});
```

- [ ] **Step 5: Run tests to verify they fail**

Run: `cd dashboard && pnpm test`
Expected: FAIL — cannot resolve `@/lib/paths` / `@/lib/reports`.

- [ ] **Step 6: Implement `lib/paths.ts` and `lib/reports.ts`**

`dashboard/lib/paths.ts`:

```ts
import path from "node:path";

export class NotFoundError extends Error {}

export function repoRoot(): string {
  return path.resolve(process.env.TA_REPO_ROOT ?? path.join(process.cwd(), ".."));
}

export function reportsDir(): string {
  return path.resolve(process.env.TA_REPORTS_DIR ?? path.join(repoRoot(), "reports"));
}

export function batchesDir(): string {
  return path.join(reportsDir(), "_batches");
}

export function pythonBin(): string {
  return process.env.TA_PYTHON ?? path.join(repoRoot(), ".venv", "bin", "python");
}

// First char excludes "_" so internal folders like _batches are never addressable as reports.
const REPORT_ID_RE = /^[A-Za-z0-9.\-^=+][A-Za-z0-9._\-^=+]*$/;
export const BATCH_ID_RE = /^\d{8}_\d{6}_[0-9a-f]{4}$/;

export function resolveReportDir(id: string): string {
  if (!REPORT_ID_RE.test(id) || /^\.+$/.test(id)) throw new NotFoundError(`Unknown report: ${id}`);
  const base = reportsDir();
  const dir = path.resolve(base, id);
  if (path.dirname(dir) !== base) throw new NotFoundError(`Unknown report: ${id}`);
  return dir;
}

export function resolveBatchFile(id: string): string {
  if (!BATCH_ID_RE.test(id)) throw new NotFoundError(`Unknown batch: ${id}`);
  return path.join(batchesDir(), `${id}.json`);
}
```

`dashboard/lib/reports.ts`:

```ts
import fs from "node:fs/promises";
import path from "node:path";
import { toLocalNaive } from "@/lib/format";
import { NotFoundError, reportsDir, resolveReportDir } from "@/lib/paths";
import type { ReportDetail, ReportListItem, ReportStep, ReportSummary, StepKey } from "@/lib/types";

const NAME_RE = /^(.+)_(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})$/;

// Mirrors tradingagents/reporting.py write_report_tree.
const STEPS: { key: StepKey; title: string; dir: string; files: [string, string][] }[] = [
  { key: "analysts", title: "Analysts", dir: "1_analysts", files: [["market", "Market Analyst"], ["sentiment", "Sentiment Analyst"], ["news", "News Analyst"], ["fundamentals", "Fundamentals Analyst"]] },
  { key: "research", title: "Research", dir: "2_research", files: [["bull", "Bull Researcher"], ["bear", "Bear Researcher"], ["manager", "Research Manager"]] },
  { key: "trading", title: "Trading", dir: "3_trading", files: [["trader", "Trader"]] },
  { key: "risk", title: "Risk", dir: "4_risk", files: [["aggressive", "Aggressive Analyst"], ["conservative", "Conservative Analyst"], ["neutral", "Neutral Analyst"]] },
  { key: "portfolio", title: "Portfolio", dir: "5_portfolio", files: [["decision", "Portfolio Manager"]] },
];

export function parseReportFolderName(name: string): { ticker: string; runAt: string | null } {
  const m = NAME_RE.exec(name);
  if (!m) return { ticker: name, runAt: null };
  const [, ticker, y, mo, d, h, mi, s] = m;
  return { ticker, runAt: `${y}-${mo}-${d}T${h}:${mi}:${s}` };
}

async function readOptional(file: string): Promise<string | null> {
  try {
    return await fs.readFile(file, "utf-8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}

function isSummary(value: unknown): value is ReportSummary {
  const v = value as Partial<ReportSummary> | null;
  return !!v && typeof v.rating === "string" && typeof v.tldr === "string" && typeof v.source_mtime === "number";
}

export async function readSummary(dir: string): Promise<{ summary: ReportSummary | null; stale: boolean }> {
  const raw = await readOptional(path.join(dir, "summary.json"));
  if (raw == null) return { summary: null, stale: false };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { summary: null, stale: false };
  }
  if (!isSummary(parsed)) return { summary: null, stale: false };
  const summary = {
    ...parsed,
    bull_points: parsed.bull_points ?? [],
    key_risks: parsed.key_risks ?? [],
    catalysts_to_watch: parsed.catalysts_to_watch ?? [],
  };
  let stale = false;
  try {
    const { mtimeMs } = await fs.stat(path.join(dir, "complete_report.md"));
    stale = Math.abs(mtimeMs / 1000 - summary.source_mtime) > 0.001;
  } catch {
    stale = false;
  }
  return { summary, stale };
}

export async function readSummaryForReport(id: string): Promise<ReportSummary | null> {
  try {
    return (await readSummary(resolveReportDir(id))).summary;
  } catch (e) {
    if (e instanceof NotFoundError) return null;
    throw e;
  }
}

async function loadListItem(id: string): Promise<ReportListItem> {
  const dir = path.join(reportsDir(), id);
  const parsed = parseReportFolderName(id);
  const runAt = parsed.runAt ?? toLocalNaive((await fs.stat(dir)).mtime);
  const { summary, stale } = await readSummary(dir);
  return { id, ticker: parsed.ticker, runAt, summary, summaryStale: stale };
}

export async function listReports(): Promise<ReportListItem[]> {
  let entries;
  try {
    entries = await fs.readdir(reportsDir(), { withFileTypes: true });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
  const items = await Promise.all(
    entries
      .filter((e) => e.isDirectory() && !e.name.startsWith("_") && !e.name.startsWith("."))
      .map((e) => loadListItem(e.name)),
  );
  return items.sort((a, b) => b.runAt.localeCompare(a.runAt));
}

export async function getReport(id: string): Promise<ReportDetail> {
  const dir = resolveReportDir(id);
  const stat = await fs.stat(dir).catch(() => null);
  if (!stat?.isDirectory()) throw new NotFoundError(`Unknown report: ${id}`);

  const steps: ReportStep[] = [];
  for (const step of STEPS) {
    const sections = [];
    for (const [key, title] of step.files) {
      const markdown = await readOptional(path.join(dir, step.dir, `${key}.md`));
      if (markdown != null) sections.push({ key, title, markdown });
    }
    if (sections.length) steps.push({ key: step.key, title: step.title, sections });
  }
  const item = await loadListItem(id);
  return { ...item, steps, complete: await readOptional(path.join(dir, "complete_report.md")) };
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd dashboard && pnpm test`
Expected: PASS (all paths + reports tests).

- [ ] **Step 8: Commit**

```bash
cd /home/tuan/Desktop/projects/TradingAgents
git add dashboard
git commit -m "feat(dashboard): scaffold Next.js app with report readers"
```

---

### Task 2: Python worker foundations — common helpers + batch store

**Files:**
- Create: `dashboard/worker/__init__.py`, `dashboard/worker/common.py`, `dashboard/worker/batch_store.py`
- Create: `dashboard/worker/tests/__init__.py`
- Test: `dashboard/worker/tests/test_batch_store.py`

**Interfaces:**
- Produces (Python):
  - `common.REPO_ROOT: Path`, `common.reports_dir() -> Path`, `common.batches_dir() -> Path`, `common.resolve_report_dir(report_id: str) -> Path` (raises `ValueError` for a bad id, `FileNotFoundError` if absent), `common.write_json_atomic(path: Path, data) -> None`, `common.now_iso() -> str`, `common.load_config() -> dict`.
  - `batch_store.load(batch_id: str) -> dict`, `batch_store.save(batch: dict) -> None`, `batch_store.mark_item(batch: dict, index: int, **fields) -> None`, `batch_store.finalize(batch: dict, cancelled: bool = False) -> dict`.

- [ ] **Step 1: Install pytest into the repo venv (dev-only, already declared in `[dev]`)**

Run: `cd /home/tuan/Desktop/projects/TradingAgents && .venv/bin/python -m pip install "pytest>=8.0"`
Expected: `Successfully installed pytest-…`

- [ ] **Step 2: Write the failing tests**

`dashboard/worker/__init__.py` and `dashboard/worker/tests/__init__.py`: empty files.

`dashboard/worker/tests/test_batch_store.py`:

```python
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
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `.venv/bin/python -m pytest dashboard/worker/tests/test_batch_store.py -q`
Expected: FAIL — `ImportError: cannot import name 'batch_store'`.

- [ ] **Step 4: Implement**

`dashboard/worker/common.py`:

```python
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

# First char excludes "_" so internal folders like _batches are never addressed as reports.
_REPORT_ID_RE = re.compile(r"^[A-Za-z0-9.\-^=+][A-Za-z0-9._\-^=+]*$")


def reports_dir() -> Path:
    return Path(os.environ.get("TA_REPORTS_DIR") or REPO_ROOT / "reports")


def batches_dir() -> Path:
    return reports_dir() / "_batches"


def resolve_report_dir(report_id: str) -> Path:
    """Return the report folder for ``report_id``; reject anything outside reports_dir()."""
    if not _REPORT_ID_RE.fullmatch(report_id or "") or set(report_id) == {"."}:
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
```

`dashboard/worker/batch_store.py`:

```python
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
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `.venv/bin/python -m pytest dashboard/worker/tests/test_batch_store.py -q`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add dashboard/worker
git commit -m "feat(dashboard): add worker path helpers and batch status store"
```

---

### Task 3: LLM report summarizer

**Files:**
- Create: `dashboard/worker/schemas.py`, `dashboard/worker/summarize.py`
- Test: `dashboard/worker/tests/test_summarize.py`

**Interfaces:**
- Consumes: `common.resolve_report_dir`, `common.write_json_atomic`, `common.now_iso`, `common.load_config`; `tradingagents.agents.schemas.PortfolioRating`, `_coerce_optional_float`; `tradingagents.agents.utils.structured.NO_EXTERNAL_TOOLS`; `tradingagents.llm_clients.base_client.normalize_content`; `tradingagents.llm_clients.factory.create_llm_client`; `TradingAgentsGraph._get_provider_kwargs`.
- Produces: `schemas.ReportSummary`; `summarize.SummaryError`; `summarize.summarize_report(report_dir: Path, llm, model_label: str) -> dict`; `summarize.build_llm(config: dict) -> tuple[llm, str]`; CLI `python -m dashboard.worker.summarize <report_id>` (exit 0 ok; 1 + one-line stderr on error; 2 on usage).

- [ ] **Step 1: Write the failing tests**

`dashboard/worker/tests/test_summarize.py`:

```python
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/bin/python -m pytest dashboard/worker/tests/test_summarize.py -q`
Expected: FAIL — `ModuleNotFoundError: dashboard.worker.summarize`.

- [ ] **Step 3: Implement `schemas.py`**

```python
"""Schema the summarizer asks the LLM to fill for one saved report."""

from __future__ import annotations

from pydantic import BaseModel, Field, field_validator

# Reuse the decision agents' rating enum and price-field coercion so a summary
# reads numbers the same way the Trader / Portfolio Manager schemas do.
from tradingagents.agents.schemas import PortfolioRating, _coerce_optional_float

_MAX_ITEMS = 3


class ReportSummary(BaseModel):
    rating: PortfolioRating = Field(
        description="The Portfolio Manager's FINAL rating: exactly one of Buy / Overweight / Hold / Underweight / Sell.",
    )
    price_target: float | None = Field(
        default=None, description="Final price target as an absolute price; null if the report gives none.",
    )
    stop_loss: float | None = Field(
        default=None, description="Stop-loss as an absolute price; null if the report gives none.",
    )
    time_horizon: str | None = Field(
        default=None, description="Time horizon as stated in the report (e.g. '3-6 months'); null if none.",
    )
    tldr: str = Field(description="At most 3 sentences: the final decision and the main reason for it.")
    bull_points: list[str] = Field(
        default_factory=list, description="Up to 3 strongest arguments for the position, one short sentence each.",
    )
    key_risks: list[str] = Field(
        default_factory=list, description="Up to 3 most important risks, one short sentence each.",
    )
    catalysts_to_watch: list[str] = Field(
        default_factory=list, description="Up to 3 upcoming events or price levels that would change the view.",
    )

    @field_validator("rating", mode="before")
    @classmethod
    def _normalize_rating(cls, value):
        return value.strip().capitalize() if isinstance(value, str) else value

    @field_validator("price_target", "stop_loss", mode="before")
    @classmethod
    def _coerce_price(cls, value):
        return _coerce_optional_float(value)

    @field_validator("bull_points", "key_risks", "catalysts_to_watch", mode="after")
    @classmethod
    def _cap_items(cls, value: list[str]) -> list[str]:
        return [s.strip() for s in value if s and s.strip()][:_MAX_ITEMS]
```

- [ ] **Step 4: Implement `summarize.py`**

```python
"""LLM summary of one saved report, written to reports/<report_id>/summary.json.

Usage: python -m dashboard.worker.summarize <report_id>
"""

from __future__ import annotations

import logging
import sys
from pathlib import Path
from types import SimpleNamespace

from pydantic import ValidationError

from dashboard.worker.common import load_config, now_iso, resolve_report_dir, write_json_atomic
from dashboard.worker.schemas import ReportSummary
from tradingagents.agents.utils.structured import NO_EXTERNAL_TOOLS
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
    from tradingagents.graph.trading_graph import TradingAgentsGraph
    from tradingagents.llm_clients.factory import create_llm_client

    # Reuse the graph's provider-kwarg mapping (effort, temperature, retries,
    # token cap) without constructing a whole graph.
    kwargs = TradingAgentsGraph._get_provider_kwargs(SimpleNamespace(config=config))
    client = create_llm_client(
        provider=config["llm_provider"],
        model=config["quick_think_llm"],
        base_url=config.get("backend_url"),
        **kwargs,
    )
    return client.get_llm(), f"{config['llm_provider']}/{config['quick_think_llm']}"


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
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `.venv/bin/python -m pytest dashboard/worker/tests -q`
Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add dashboard/worker
git commit -m "feat(dashboard): add LLM report summarizer worker"
```

---

### Task 4: Batch runner worker

**Files:**
- Create: `dashboard/worker/run_batch.py`
- Test: `dashboard/worker/tests/test_run_batch.py`

**Interfaces:**
- Consumes: `batch_store.load/save/mark_item/finalize`, `common.load_config/reports_dir/now_iso`, `summarize.build_llm/summarize_report`; `cli.utils.normalize_ticker_symbol`, `cli.utils.detect_asset_type`, `cli.utils.filter_analysts_for_asset_type`, `cli.models.AnalystType`; `tradingagents.dataflows.utils.safe_ticker_component`; `TradingAgentsGraph(selected_analysts, config=...)` with `.propagate(ticker, date, asset_type=...) -> (state, signal)` and `.save_reports(state, ticker, path)`.
- Produces: `run_batch.Cancelled(BaseException)`; `run_batch.run(batch_id: str, *, graph_factory=None, summarizer=None) -> dict`; CLI `python -m dashboard.worker.run_batch <batch_id>` (installs a SIGTERM handler that raises `Cancelled`).

- [ ] **Step 1: Write the failing tests**

`dashboard/worker/tests/test_run_batch.py`:

```python
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv/bin/python -m pytest dashboard/worker/tests/test_run_batch.py -q`
Expected: FAIL — `ImportError: cannot import name 'run_batch'`.

- [ ] **Step 3: Implement `run_batch.py`**

```python
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
from dashboard.worker.common import load_config, now_iso, reports_dir

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


def _run_one(ticker: str, params: dict, config: dict, graphs: dict, graph_factory) -> tuple[str, str]:
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
    graph.save_reports(final_state, ticker, reports_dir() / report_id)
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
                report_id, rating = _run_one(item["ticker"], params, config, graphs, graph_factory)
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv/bin/python -m pytest dashboard/worker/tests -q`
Expected: all PASS.

- [ ] **Step 5: Smoke-check the real imports resolve (no LLM call)**

Run: `.venv/bin/python -c "import dashboard.worker.run_batch as r, cli.utils, tradingagents.graph.trading_graph; print('ok')" && .venv/bin/python -m dashboard.worker.run_batch; echo "exit=$?"`
Expected: `ok`, then the usage line and `exit=2`.

- [ ] **Step 6: Commit**

```bash
git add dashboard/worker
git commit -m "feat(dashboard): add batch runner worker"
```

---

### Task 5: Batch library + Python launcher (TS)

**Files:**
- Create: `dashboard/lib/batches.ts`, `dashboard/lib/python.ts`, `dashboard/lib/compare.ts`
- Test: `dashboard/lib/__tests__/batches.test.ts`, `dashboard/lib/__tests__/compare.test.ts`

**Interfaces:**
- Consumes: `paths.*`, `types.*`, `format.todayLocal`.
- Produces:
  - `validateParams(body: unknown, today?: string): { ok: true; params: BatchParams } | { ok: false; error: string }`
  - `newBatchId(now?: Date): string`, `createBatchRecord(params: BatchParams, id: string, now?: Date): Batch`
  - `writeBatch(batch: Batch): Promise<void>`, `getBatch(id: string): Promise<Batch>` (NotFoundError), `listBatches(): Promise<Batch[]>` (newest first, corrupt files skipped)
  - `isPidAlive(pid: number): boolean`, `isActive(batch: Batch, now?: number, alive?: (pid: number) => boolean): boolean`, `isOrphaned(batch: Batch, ...same): boolean`, `findActiveBatch(): Promise<Batch | null>`
  - `batchLogPath(id: string): string`, `readLogTail(id: string, lines?: number): Promise<string>`
  - `spawnWorker(module: string, args: string[], logFile: string): Promise<number>` (resolves pid after the `spawn` event; rejects on `error`)
  - `runWorker(module: string, args: string[], timeoutMs: number): Promise<{ code: number | null; stderr: string }>`
  - `ComparisonRow { ticker: string; reportId: string; summary: ReportSummary }`, `sortForComparison(rows: ComparisonRow[]): ComparisonRow[]`

- [ ] **Step 1: Write the failing tests**

`dashboard/lib/__tests__/batches.test.ts`:

```ts
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  createBatchRecord, getBatch, isActive, isOrphaned, listBatches, newBatchId, validateParams, writeBatch,
} from "@/lib/batches";
import { NotFoundError } from "@/lib/paths";
import type { Batch } from "@/lib/types";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "ta-batches-"));
  process.env.TA_REPORTS_DIR = dir;
});

const base = { tickers: "NVDA", trade_date: "2026-10-03", analysts: ["market"] };
const TODAY = "2026-10-05";

describe("validateParams", () => {
  it("normalizes loosely typed tickers: case, separators, duplicates", () => {
    const r = validateParams({ ...base, tickers: "nvda, MSFT\nnvda ;btc-usd" }, TODAY);
    expect(r.ok && r.params.tickers).toEqual(["NVDA", "MSFT", "BTC-USD"]);
  });

  it("accepts an array of tickers and applies defaults", () => {
    const r = validateParams({ ...base, tickers: ["spy", "^gspc"] }, TODAY);
    expect(r).toEqual({
      ok: true,
      params: {
        tickers: ["SPY", "^GSPC"], trade_date: "2026-10-03", analysts: ["market"],
        max_debate_rounds: 1, max_risk_discuss_rounds: 1, auto_summarize: true,
      },
    });
  });

  it("orders and dedupes analysts canonically", () => {
    const r = validateParams({ ...base, analysts: ["news", "market", "news"] }, TODAY);
    expect(r.ok && r.params.analysts).toEqual(["market", "news"]);
  });

  it.each([
    [{ ...base, tickers: " , " }, /at least one ticker/i],
    [{ ...base, tickers: Array.from({ length: 21 }, (_, i) => `T${i}`) }, /at most 20/i],
    [{ ...base, tickers: "NVDA ../etc" }, /invalid ticker/i],
    [{ ...base, tickers: "..." }, /invalid ticker/i],
    [{ ...base, trade_date: "2026-13-01" }, /trade date/i],
    [{ ...base, trade_date: "2026-02-30" }, /trade date/i],
    [{ ...base, trade_date: "2026-10-06" }, /future/i],
    [{ ...base, analysts: [] }, /analyst/i],
    [{ ...base, analysts: ["market", "astrology"] }, /analyst/i],
    [{ ...base, max_debate_rounds: 0 }, /debate rounds/i],
    [{ ...base, max_risk_discuss_rounds: 2.5 }, /risk rounds/i],
    [null, /tickers/i],
  ])("rejects %j", (body, message) => {
    const r = validateParams(body, TODAY);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(message);
  });
});

describe("batch records and files", () => {
  it("creates ids and records with pending items", () => {
    const id = newBatchId(new Date(2026, 9, 5, 10, 15, 0));
    expect(id).toMatch(/^20261005_101500_[0-9a-f]{4}$/);
    const r = validateParams(base, TODAY);
    if (!r.ok) throw new Error(r.error);
    const batch = createBatchRecord(r.params, id);
    expect(batch.status).toBe("queued");
    expect(batch.items).toEqual([{
      ticker: "NVDA", status: "pending", started_at: null, finished_at: null,
      report_id: null, signal: null, summary_status: "none", error: null,
    }]);
  });

  it("round-trips, lists newest first, and skips corrupt files", async () => {
    const r = validateParams(base, TODAY);
    if (!r.ok) throw new Error(r.error);
    await writeBatch(createBatchRecord(r.params, "20261004_090000_aaaa"));
    await writeBatch(createBatchRecord(r.params, "20261005_090000_bbbb"));
    writeFileSync(path.join(dir, "_batches", "20261005_100000_cccc.json"), "{ half");
    writeFileSync(path.join(dir, "_batches", "20261005_090000_bbbb.log"), "log");

    expect((await listBatches()).map((b) => b.id)).toEqual(["20261005_090000_bbbb", "20261004_090000_aaaa"]);
    expect((await getBatch("20261004_090000_aaaa")).params.tickers).toEqual(["NVDA"]);
    await expect(getBatch("20261001_000000_dddd")).rejects.toThrow(NotFoundError);
  });

  it("listBatches returns [] when there is no _batches dir", async () => {
    mkdirSync(path.join(dir, "x"));
    expect(await listBatches()).toEqual([]);
  });
});

describe("isActive / isOrphaned", () => {
  const now = Date.parse("2026-10-05T10:20:00Z");
  const mk = (status: Batch["status"], pid: number | null, created = "2026-10-05T10:19:30Z") =>
    ({ status, pid, created_at: created } as Batch);
  const alive = () => true;
  const dead = () => false;

  it("is active while running with a live pid", () => {
    expect(isActive(mk("running", 123), now, alive)).toBe(true);
  });
  it("is not active when the worker died; that batch is orphaned", () => {
    expect(isActive(mk("running", 123), now, dead)).toBe(false);
    expect(isOrphaned(mk("running", 123), now, dead)).toBe(true);
  });
  it("gives a queued batch without a pid a 2-minute grace period", () => {
    expect(isActive(mk("queued", null), now, dead)).toBe(true);
    expect(isActive(mk("queued", null, "2026-10-05T10:10:00Z"), now, dead)).toBe(false);
  });
  it("terminal statuses are never active or orphaned", () => {
    for (const s of ["done", "partial", "failed", "cancelled"] as const) {
      expect(isActive(mk(s, 123), now, alive)).toBe(false);
      expect(isOrphaned(mk(s, 123), now, dead)).toBe(false);
    }
  });
});
```

`dashboard/lib/__tests__/compare.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { sortForComparison, type ComparisonRow } from "@/lib/compare";
import type { ReportSummary } from "@/lib/types";

const row = (ticker: string, rating: string): ComparisonRow => ({
  ticker, reportId: `${ticker}_20261005_101500`, summary: { rating } as ReportSummary,
});

describe("sortForComparison", () => {
  it("orders Buy → Sell, unknown ratings last, ties by ticker", () => {
    const rows = [row("Z", "Hold"), row("A", "Sell"), row("M", "Buy"), row("B", "Hold"), row("Q", "REVIEW"), row("C", "Overweight")];
    expect(sortForComparison(rows).map((r) => r.ticker)).toEqual(["M", "C", "B", "Z", "A", "Q"]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd dashboard && pnpm test`
Expected: FAIL — cannot resolve `@/lib/batches` / `@/lib/compare`.

- [ ] **Step 3: Implement `lib/compare.ts`**

```ts
import { RATINGS, type ReportSummary } from "@/lib/types";

export interface ComparisonRow {
  ticker: string;
  reportId: string;
  summary: ReportSummary;
}

const rank = (rating: string) => {
  const i = (RATINGS as readonly string[]).indexOf(rating);
  return i === -1 ? RATINGS.length : i;
};

export function sortForComparison(rows: ComparisonRow[]): ComparisonRow[] {
  return [...rows].sort(
    (a, b) => rank(a.summary.rating) - rank(b.summary.rating) || a.ticker.localeCompare(b.ticker),
  );
}
```

- [ ] **Step 4: Implement `lib/batches.ts`**

```ts
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { todayLocal, toLocalNaive } from "@/lib/format";
import { NotFoundError, batchesDir, resolveBatchFile } from "@/lib/paths";
import { ANALYSTS, type Analyst, type Batch, type BatchParams } from "@/lib/types";

const TICKER_RE = /^[A-Z0-9.\-^=]{1,32}$/;
const MAX_TICKERS = 20;
const QUEUED_GRACE_MS = 120_000;

type Validation = { ok: true; params: BatchParams } | { ok: false; error: string };

function rounds(value: unknown, label: string): number | string {
  if (value === undefined || value === null || value === "") return 1;
  const n = typeof value === "string" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isInteger(n) || n < 1 || n > 5) return `${label} must be a whole number from 1 to 5`;
  return n;
}

function isValidDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function validateParams(body: unknown, today: string = todayLocal()): Validation {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;

  const raw = typeof b.tickers === "string" ? b.tickers.split(/[\s,;]+/) : Array.isArray(b.tickers) ? b.tickers : null;
  if (!raw) return { ok: false, error: "tickers is required" };
  const tickers = [...new Set(raw.map((t) => String(t).trim().toUpperCase()).filter(Boolean))];
  if (tickers.length === 0) return { ok: false, error: "Enter at least one ticker" };
  if (tickers.length > MAX_TICKERS) return { ok: false, error: `At most ${MAX_TICKERS} tickers per batch` };
  const bad = tickers.filter((t) => !TICKER_RE.test(t) || /^\.+$/.test(t));
  if (bad.length) return { ok: false, error: `Invalid ticker(s): ${bad.join(", ")}` };

  const trade_date = typeof b.trade_date === "string" ? b.trade_date.trim() : "";
  if (!isValidDate(trade_date)) return { ok: false, error: "Trade date must be a valid YYYY-MM-DD date" };
  if (trade_date > today) return { ok: false, error: "Trade date cannot be in the future" };

  const requested = Array.isArray(b.analysts) ? b.analysts.map(String) : [];
  if (requested.some((a) => !(ANALYSTS as readonly string[]).includes(a))) {
    return { ok: false, error: `Unknown analyst; choose from ${ANALYSTS.join(", ")}` };
  }
  const analysts = ANALYSTS.filter((a) => requested.includes(a)) as Analyst[];
  if (analysts.length === 0) return { ok: false, error: "Select at least one analyst" };

  const debate = rounds(b.max_debate_rounds, "Debate rounds");
  if (typeof debate === "string") return { ok: false, error: debate };
  const risk = rounds(b.max_risk_discuss_rounds, "Risk rounds");
  if (typeof risk === "string") return { ok: false, error: risk };

  return {
    ok: true,
    params: {
      tickers, trade_date, analysts,
      max_debate_rounds: debate, max_risk_discuss_rounds: risk,
      auto_summarize: b.auto_summarize !== false,
    },
  };
}

export function newBatchId(now: Date = new Date()): string {
  const stamp = toLocalNaive(now).replace(/[-:]/g, "").replace("T", "_");
  return `${stamp}_${randomBytes(2).toString("hex")}`;
}

export function createBatchRecord(params: BatchParams, id: string, now: Date = new Date()): Batch {
  const iso = now.toISOString().replace(/\.\d{3}Z$/, "Z");
  return {
    id, created_at: iso, updated_at: iso, status: "queued", pid: null, error: null, params,
    items: params.tickers.map((ticker) => ({
      ticker, status: "pending", started_at: null, finished_at: null,
      report_id: null, signal: null, summary_status: "none", error: null,
    })),
  };
}

export async function writeBatch(batch: Batch): Promise<void> {
  const file = resolveBatchFile(batch.id);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(batch, null, 2), "utf-8");
  await fs.rename(tmp, file);
}

export async function getBatch(id: string): Promise<Batch> {
  const file = resolveBatchFile(id);
  try {
    return JSON.parse(await fs.readFile(file, "utf-8")) as Batch;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") throw new NotFoundError(`Unknown batch: ${id}`);
    throw e;
  }
}

export async function listBatches(): Promise<Batch[]> {
  let names: string[];
  try {
    names = await fs.readdir(batchesDir());
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
  const batches = await Promise.all(
    names
      .filter((n) => n.endsWith(".json"))
      .map((n) => getBatch(n.slice(0, -".json".length)).catch(() => null)),
  );
  return batches.filter((b): b is Batch => b !== null).sort((a, b) => b.id.localeCompare(a.id));
}

export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

const isOpen = (b: Batch) => b.status === "queued" || b.status === "running";

export function isActive(batch: Batch, now: number = Date.now(), alive: (pid: number) => boolean = isPidAlive): boolean {
  if (!isOpen(batch)) return false;
  if (batch.pid == null) return now - Date.parse(batch.created_at) < QUEUED_GRACE_MS;
  return alive(batch.pid);
}

/** Non-terminal status but the worker is gone (crashed, killed, machine rebooted). */
export function isOrphaned(batch: Batch, now: number = Date.now(), alive: (pid: number) => boolean = isPidAlive): boolean {
  return isOpen(batch) && !isActive(batch, now, alive);
}

export async function findActiveBatch(): Promise<Batch | null> {
  return (await listBatches()).find((b) => isActive(b)) ?? null;
}

export function batchLogPath(id: string): string {
  return resolveBatchFile(id).replace(/\.json$/, ".log");
}

export async function readLogTail(id: string, lines = 50): Promise<string> {
  try {
    const text = await fs.readFile(batchLogPath(id), "utf-8");
    return text.split("\n").slice(-lines - 1).join("\n").trimEnd();
  } catch {
    return "";
  }
}
```

- [ ] **Step 5: Implement `lib/python.ts`**

```ts
import { spawn } from "node:child_process";
import fs from "node:fs";
import { pythonBin, repoRoot, reportsDir } from "@/lib/paths";

function workerEnv(): NodeJS.ProcessEnv {
  return { ...process.env, TA_REPORTS_DIR: reportsDir(), PYTHONUNBUFFERED: "1" };
}

/** Start a detached worker that outlives this request (and the dev server). Resolves with its pid. */
export function spawnWorker(module: string, args: string[], logFile: string): Promise<number> {
  const log = fs.openSync(logFile, "a");
  return new Promise((resolve, reject) => {
    const child = spawn(pythonBin(), ["-m", module, ...args], {
      cwd: repoRoot(),
      env: workerEnv(),
      detached: true,
      stdio: ["ignore", log, log],
    });
    child.once("error", (err) => {
      fs.closeSync(log);
      reject(err);
    });
    child.once("spawn", () => {
      fs.closeSync(log);
      child.unref();
      resolve(child.pid!);
    });
  });
}

/** Run a worker to completion and capture stderr (last 10 KB). */
export function runWorker(module: string, args: string[], timeoutMs: number): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(pythonBin(), ["-m", module, ...args], {
      cwd: repoRoot(),
      env: workerEnv(),
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr = (stderr + chunk.toString()).slice(-10_000);
    });
    const timer = setTimeout(() => {
      stderr += `\nTimed out after ${Math.round(timeoutMs / 1000)}s`;
      child.kill("SIGTERM");
    }, timeoutMs);
    child.once("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stderr });
    });
  });
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd dashboard && pnpm test`
Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add dashboard/lib
git commit -m "feat(dashboard): add batch validation, storage and worker launcher"
```

---

### Task 6: API routes

**Files:**
- Create: `dashboard/app/api/batches/route.ts`, `dashboard/app/api/batches/[id]/route.ts`, `dashboard/app/api/reports/[id]/summary/route.ts`

**Interfaces:**
- Consumes: everything from Task 5, `resolveReportDir`, `readSummary`, `pythonBin`, `NotFoundError`.
- Produces (HTTP):
  - `GET /api/batches` → `200 Batch[]`
  - `POST /api/batches` (JSON body per `validateParams`) → `201 {id}` | `400 {error}` | `409 {error, activeBatchId}` | `500 {error}`
  - `GET /api/batches/:id` → `200 Batch & {active: boolean; orphaned: boolean}` | `404`
  - `DELETE /api/batches/:id` → `200 {ok: true, action: "signalled" | "marked-failed" | "none"}` | `404`
  - `POST /api/reports/:id/summary` → `200 ReportSummary` | `404 {error}` | `500 {error}`

- [ ] **Step 1: Implement `app/api/batches/route.ts`**

```ts
import { NextResponse } from "next/server";
import {
  batchLogPath, createBatchRecord, findActiveBatch, listBatches, newBatchId, validateParams, writeBatch,
} from "@/lib/batches";
import { pythonBin } from "@/lib/paths";
import { spawnWorker } from "@/lib/python";

export async function GET() {
  return NextResponse.json(await listBatches());
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON" }, { status: 400 });
  }
  const v = validateParams(body);
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });

  const active = await findActiveBatch();
  if (active) {
    return NextResponse.json({ error: "A batch is already running", activeBatchId: active.id }, { status: 409 });
  }

  const batch = createBatchRecord(v.params, newBatchId());
  await writeBatch(batch);
  try {
    await spawnWorker("dashboard.worker.run_batch", [batch.id], batchLogPath(batch.id));
  } catch (e) {
    batch.status = "failed";
    batch.error = `Could not start the Python worker (${pythonBin()}): ${(e as Error).message}. Set TA_PYTHON.`;
    await writeBatch(batch);
    return NextResponse.json({ error: batch.error }, { status: 500 });
  }
  return NextResponse.json({ id: batch.id }, { status: 201 });
}
```

- [ ] **Step 2: Implement `app/api/batches/[id]/route.ts`**

```ts
import { NextResponse } from "next/server";
import { getBatch, isActive, isOrphaned, writeBatch } from "@/lib/batches";
import { NotFoundError } from "@/lib/paths";
import type { Batch } from "@/lib/types";

type Ctx = { params: Promise<{ id: string }> };

async function load(id: string): Promise<Batch | null> {
  try {
    return await getBatch(id);
  } catch (e) {
    if (e instanceof NotFoundError) return null;
    throw e;
  }
}

export async function GET(_req: Request, { params }: Ctx) {
  const batch = await load((await params).id);
  if (!batch) return NextResponse.json({ error: "Batch not found" }, { status: 404 });
  return NextResponse.json({ ...batch, active: isActive(batch), orphaned: isOrphaned(batch) });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const batch = await load((await params).id);
  if (!batch) return NextResponse.json({ error: "Batch not found" }, { status: 404 });

  if (isActive(batch) && batch.pid != null) {
    process.kill(batch.pid, "SIGTERM");
    return NextResponse.json({ ok: true, action: "signalled" });
  }
  if (isOrphaned(batch)) {
    batch.status = "failed";
    batch.error = "Worker exited unexpectedly";
    for (const item of batch.items) {
      if (item.status === "pending" || item.status === "running") item.status = "failed";
    }
    batch.updated_at = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
    await writeBatch(batch);
    return NextResponse.json({ ok: true, action: "marked-failed" });
  }
  return NextResponse.json({ ok: true, action: "none" });
}
```

Note: a batch that is `queued` within its 2-minute grace period has `pid == null`; DELETE returns `action: "none"` — the UI only shows Cancel once the worker has written its pid.

- [ ] **Step 3: Implement `app/api/reports/[id]/summary/route.ts`**

```ts
import fs from "node:fs/promises";
import { NextResponse } from "next/server";
import { NotFoundError, resolveReportDir } from "@/lib/paths";
import { runWorker } from "@/lib/python";
import { readSummary } from "@/lib/reports";

type Ctx = { params: Promise<{ id: string }> };

const lastLine = (text: string) => text.trim().split("\n").pop() ?? "";

export async function POST(_req: Request, { params }: Ctx) {
  const { id } = await params;
  let dir: string;
  try {
    dir = resolveReportDir(id);
    if (!(await fs.stat(dir).catch(() => null))?.isDirectory()) throw new NotFoundError(id);
  } catch (e) {
    if (e instanceof NotFoundError) return NextResponse.json({ error: "Report not found" }, { status: 404 });
    throw e;
  }

  let result;
  try {
    result = await runWorker("dashboard.worker.summarize", [id], 180_000);
  } catch (e) {
    return NextResponse.json({ error: `Could not start the Python worker: ${(e as Error).message}` }, { status: 500 });
  }
  if (result.code !== 0) {
    return NextResponse.json(
      { error: lastLine(result.stderr) || `Summarizer exited with code ${result.code}` },
      { status: 500 },
    );
  }
  const { summary } = await readSummary(dir);
  return summary
    ? NextResponse.json(summary)
    : NextResponse.json({ error: "Summarizer finished but wrote no summary" }, { status: 500 });
}
```

- [ ] **Step 4: Type-check and build**

Run: `cd dashboard && pnpm exec tsc --noEmit && pnpm build`
Expected: no type errors; build succeeds and lists the three `ƒ /api/...` dynamic routes.

- [ ] **Step 5: Smoke-test against a temp reports dir (no LLM calls)**

```bash
cd /home/tuan/Desktop/projects/TradingAgents/dashboard
SMOKE=$(mktemp -d)
mkdir -p "$SMOKE/_batches"
# a fake "running" batch owned by this shell's pid → must block new batches
cat > "$SMOKE/_batches/20261005_090000_aaaa.json" <<EOF
{"id":"20261005_090000_aaaa","created_at":"2026-10-05T09:00:00Z","updated_at":"2026-10-05T09:00:00Z",
 "status":"running","pid":$$,"error":null,
 "params":{"tickers":["NVDA"],"trade_date":"2026-10-03","analysts":["market"],"max_debate_rounds":1,"max_risk_discuss_rounds":1,"auto_summarize":true},
 "items":[{"ticker":"NVDA","status":"running","started_at":null,"finished_at":null,"report_id":null,"signal":null,"summary_status":"none","error":null}]}
EOF
TA_REPORTS_DIR="$SMOKE" PORT=3123 pnpm start > "$SMOKE/server.log" 2>&1 &
SERVER=$!; sleep 4
curl -s -o /dev/null -w "%{http_code}\n" -X POST localhost:3123/api/batches -H 'content-type: application/json' -d '{"tickers":"../x","trade_date":"2026-10-03","analysts":["market"]}'   # 400
curl -s -w "\n" -X POST localhost:3123/api/batches -H 'content-type: application/json' -d '{"tickers":"NVDA","trade_date":"2026-10-03","analysts":["market"]}'   # 409 + activeBatchId
curl -s -o /dev/null -w "%{http_code}\n" localhost:3123/api/batches/20261005_090000_bbbb   # 404
curl -s -o /dev/null -w "%{http_code}\n" -X POST localhost:3123/api/reports/..%2Fetc/summary   # 404
# orphan it: point the pid at a dead process, then DELETE marks it failed
sed -i "s/\"pid\":$$/\"pid\":999999/" "$SMOKE/_batches/20261005_090000_aaaa.json"
curl -s -w "\n" -X DELETE localhost:3123/api/batches/20261005_090000_aaaa   # {"ok":true,"action":"marked-failed"}
kill $SERVER
```

Expected: `400`, a 409 JSON body containing `"activeBatchId":"20261005_090000_aaaa"`, `404`, `404`, `{"ok":true,"action":"marked-failed"}`.

- [ ] **Step 6: Commit**

```bash
git add dashboard/app/api
git commit -m "feat(dashboard): add batch and summary API routes"
```

---

### Task 7: Layout, shared components, report pages

**Files:**
- Modify: `dashboard/app/layout.tsx`, replace `dashboard/app/page.tsx`
- Create: `dashboard/components/nav.tsx`, `rating-badge.tsx`, `markdown.tsx`, `summary-card.tsx`, `summarize-button.tsx`, `reports-table.tsx`
- Create: `dashboard/app/reports/[id]/page.tsx`, `dashboard/app/reports/[id]/not-found.tsx`

**Interfaces:**
- Consumes: `listReports`, `getReport`, `NotFoundError`, `formatPrice`, `formatRunAt`, `formatIso`, types.
- Produces: `<RatingBadge rating={string | null} />`, `<Markdown>{string}</Markdown>`, `<SummaryCard summary={ReportSummary} stale={boolean} />`, `<SummarizeButton reportId label? />`, `<ReportsTable reports={ReportListItem[]} />` — reused in Task 8.

- [ ] **Step 1: Layout + nav**

`dashboard/components/nav.tsx`:

```tsx
import Link from "next/link";

const LINKS = [
  { href: "/", label: "Reports" },
  { href: "/batches", label: "Batches" },
  { href: "/batches/new", label: "New batch" },
];

export function Nav() {
  return (
    <header className="border-b">
      <nav className="mx-auto flex max-w-6xl items-center gap-6 px-4 py-3">
        <Link href="/" className="font-semibold">TradingAgents</Link>
        {LINKS.map((l) => (
          <Link key={l.href} href={l.href} className="text-sm text-muted-foreground hover:text-foreground">
            {l.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
```

In `dashboard/app/layout.tsx` keep the generated font setup, set `metadata = { title: "TradingAgents Dashboard", description: "Reports, batch analysis and summaries" }`, and make the body:

```tsx
<body className={`${geistSans.variable} ${geistMono.variable} min-h-screen bg-background text-foreground antialiased`}>
  <Nav />
  <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
</body>
```

(import `{ Nav } from "@/components/nav"`; keep whatever font variable names create-next-app generated).

- [ ] **Step 2: Small shared components**

`dashboard/components/rating-badge.tsx`:

```tsx
import { Badge } from "@/components/ui/badge";

const TONE: Record<string, string> = {
  Buy: "bg-emerald-600 text-white border-transparent",
  Overweight: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
  Hold: "bg-muted text-foreground",
  Underweight: "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200",
  Sell: "bg-red-600 text-white border-transparent",
  REVIEW: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
};

export function RatingBadge({ rating }: { rating: string | null | undefined }) {
  if (!rating) return <span className="text-muted-foreground">—</span>;
  return <Badge variant="outline" className={TONE[rating] ?? ""}>{rating}</Badge>;
}
```

`dashboard/components/markdown.tsx`:

```tsx
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function Markdown({ children }: { children: string }) {
  return (
    <div className="prose prose-sm max-w-none dark:prose-invert">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  );
}
```

`dashboard/components/summarize-button.tsx`:

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";

export function SummarizeButton({ reportId, label = "Summarize" }: { reportId: string; label?: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/reports/${encodeURIComponent(reportId)}/summary`, { method: "POST" });
      if (!res.ok) setError((await res.json().catch(() => ({}))).error ?? `Failed (${res.status})`);
      else router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending(false);
    }
  }

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <Button size="sm" variant="outline" onClick={run} disabled={pending}>
        {pending ? "Summarizing…" : label}
      </Button>
      {error && <span className="max-w-xs text-xs text-red-600">{error}</span>}
    </span>
  );
}
```

`dashboard/components/summary-card.tsx`:

```tsx
import { RatingBadge } from "@/components/rating-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatIso, formatPrice } from "@/lib/format";
import type { ReportSummary } from "@/lib/types";

function List({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div>
      <h3 className="mb-1 text-sm font-medium">{title}</h3>
      <ul className="list-disc space-y-1 pl-5 text-sm">{items.map((i) => <li key={i}>{i}</li>)}</ul>
    </div>
  );
}

export function SummaryCard({ summary, stale }: { summary: ReportSummary; stale: boolean }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-3 text-base">
          <RatingBadge rating={summary.rating} />
          <span>Target {formatPrice(summary.price_target)}</span>
          <span>Stop {formatPrice(summary.stop_loss)}</span>
          <span>{summary.time_horizon ?? "—"}</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p>{summary.tldr}</p>
        <div className="grid gap-4 md:grid-cols-3">
          <List title="Bull points" items={summary.bull_points} />
          <List title="Key risks" items={summary.key_risks} />
          <List title="Catalysts to watch" items={summary.catalysts_to_watch} />
        </div>
        <p className="text-xs text-muted-foreground">
          {summary.model} · {formatIso(summary.generated_at)}
          {stale && <span className="ml-2 text-amber-600">Stale: the report changed after this summary was written.</span>}
        </p>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 3: Reports list (client-side filtering)**

`dashboard/components/reports-table.tsx`:

```tsx
"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { RatingBadge } from "@/components/rating-badge";
import { SummarizeButton } from "@/components/summarize-button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatPrice, formatRunAt } from "@/lib/format";
import type { ReportListItem } from "@/lib/types";

export function ReportsTable({ reports }: { reports: ReportListItem[] }) {
  const [ticker, setTicker] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const rows = useMemo(() => {
    const q = ticker.trim().toUpperCase();
    return reports.filter((r) => {
      const day = r.runAt.slice(0, 10);
      return (!q || r.ticker.toUpperCase().includes(q)) && (!from || day >= from) && (!to || day <= to);
    });
  }, [reports, ticker, from, to]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3">
        <Input placeholder="Filter ticker" value={ticker} onChange={(e) => setTicker(e.target.value)} className="w-40" />
        <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-44" aria-label="From date" />
        <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-44" aria-label="To date" />
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Ticker</TableHead>
            <TableHead>Run time</TableHead>
            <TableHead>Rating</TableHead>
            <TableHead className="text-right">Target</TableHead>
            <TableHead>Horizon</TableHead>
            <TableHead>TL;DR</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id}>
              <TableCell className="font-medium">
                <Link href={`/reports/${encodeURIComponent(r.id)}`} className="underline-offset-4 hover:underline">{r.ticker}</Link>
              </TableCell>
              <TableCell className="whitespace-nowrap">{formatRunAt(r.runAt)}</TableCell>
              <TableCell><RatingBadge rating={r.summary?.rating} /></TableCell>
              <TableCell className="text-right">{formatPrice(r.summary?.price_target)}</TableCell>
              <TableCell>{r.summary?.time_horizon ?? "—"}</TableCell>
              <TableCell className="max-w-md">
                {r.summary ? <span className="line-clamp-2 text-sm">{r.summary.tldr}</span> : <SummarizeButton reportId={r.id} />}
              </TableCell>
            </TableRow>
          ))}
          {rows.length === 0 && (
            <TableRow>
              <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">No reports match.</TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
```

`dashboard/app/page.tsx`:

```tsx
import { ReportsTable } from "@/components/reports-table";
import { listReports } from "@/lib/reports";

export const dynamic = "force-dynamic";

export default async function ReportsPage() {
  const reports = await listReports();
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Reports</h1>
      <ReportsTable reports={reports} />
    </div>
  );
}
```

- [ ] **Step 4: Report detail**

`dashboard/app/reports/[id]/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import { Markdown } from "@/components/markdown";
import { SummarizeButton } from "@/components/summarize-button";
import { SummaryCard } from "@/components/summary-card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatRunAt } from "@/lib/format";
import { NotFoundError } from "@/lib/paths";
import { getReport } from "@/lib/reports";
import type { ReportDetail } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let report: ReportDetail;
  try {
    report = await getReport(decodeURIComponent(id));
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const tabs = [
    ...report.steps.map((s) => ({ key: s.key, title: s.title, body: s.sections.map((x) => `## ${x.title}\n\n${x.markdown}`).join("\n\n") })),
    ...(report.complete ? [{ key: "full", title: "Full report", body: report.complete }] : []),
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-2xl font-semibold">
          {report.ticker} <span className="text-base font-normal text-muted-foreground">{formatRunAt(report.runAt)}</span>
        </h1>
        {report.complete && (
          <SummarizeButton reportId={report.id} label={report.summary ? "Regenerate summary" : "Summarize"} />
        )}
      </div>
      {report.summary && <SummaryCard summary={report.summary} stale={report.summaryStale} />}
      {tabs.length > 0 ? (
        <Tabs defaultValue={tabs[0].key}>
          <TabsList className="flex-wrap">
            {tabs.map((t) => <TabsTrigger key={t.key} value={t.key}>{t.title}</TabsTrigger>)}
          </TabsList>
          {tabs.map((t) => (
            <TabsContent key={t.key} value={t.key} className="pt-4"><Markdown>{t.body}</Markdown></TabsContent>
          ))}
        </Tabs>
      ) : (
        <p className="text-muted-foreground">This report folder has no report files.</p>
      )}
    </div>
  );
}
```

`dashboard/app/reports/[id]/not-found.tsx`:

```tsx
import Link from "next/link";

export default function NotFound() {
  return (
    <div className="space-y-2">
      <h1 className="text-xl font-semibold">Report not found</h1>
      <Link href="/" className="underline">Back to reports</Link>
    </div>
  );
}
```

Note: Next.js already decodes dynamic segments; `decodeURIComponent` on an already-decoded id is a no-op for valid ids (they contain no `%`).

- [ ] **Step 5: Verify**

Run: `cd dashboard && pnpm exec tsc --noEmit && pnpm lint && pnpm build`
Then: `pnpm dev`, open http://localhost:3000 — the 8 existing reports in `../reports` are listed with "Summarize" buttons; open one (e.g. SPY) and check that every tab renders its markdown and tables. Stop the dev server.

- [ ] **Step 6: Commit**

```bash
git add dashboard
git commit -m "feat(dashboard): add reports list and report detail pages"
```

---

### Task 8: Batch pages + comparison table

**Files:**
- Create: `dashboard/components/auto-refresh.tsx`, `cancel-batch-button.tsx`, `new-batch-form.tsx`, `comparison-table.tsx`, `batch-status-badge.tsx`
- Create: `dashboard/app/batches/page.tsx`, `dashboard/app/batches/new/page.tsx`, `dashboard/app/batches/[id]/page.tsx`, `dashboard/app/batches/[id]/not-found.tsx`

**Interfaces:**
- Consumes: `listBatches`, `getBatch`, `isActive`, `isOrphaned`, `readLogTail`, `readSummaryForReport`, `sortForComparison`, `ComparisonRow`, `RatingBadge`, `formatPrice`, `formatIso`, `todayLocal`, `ANALYSTS`, `ANALYST_LABELS`.
- Produces: pages only.

Live progress: the spec describes polling `GET /api/batches/[id]`; this plan instead refreshes the server-rendered page every 3 s with `router.refresh()` while the batch is active, which reuses the server rendering and needs no duplicate client rendering. The GET route stays available for scripts.

- [ ] **Step 1: Client helpers**

`dashboard/components/auto-refresh.tsx`:

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Re-render the server page every `intervalMs` while `active`. */
export function AutoRefresh({ active, intervalMs = 3000 }: { active: boolean; intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(t);
  }, [active, intervalMs, router]);
  return null;
}
```

`dashboard/components/cancel-batch-button.tsx`:

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";

export function CancelBatchButton({ batchId, label = "Cancel batch" }: { batchId: string; label?: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  return (
    <Button
      size="sm"
      variant="destructive"
      disabled={pending}
      onClick={async () => {
        setPending(true);
        await fetch(`/api/batches/${batchId}`, { method: "DELETE" });
        setPending(false);
        router.refresh();
      }}
    >
      {pending ? "Cancelling…" : label}
    </Button>
  );
}
```

`dashboard/components/batch-status-badge.tsx`:

```tsx
import { Badge } from "@/components/ui/badge";

const TONE: Record<string, string> = {
  queued: "bg-muted text-foreground",
  pending: "bg-muted text-muted-foreground",
  running: "bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-200",
  done: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
  partial: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  failed: "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200",
  cancelled: "bg-muted text-muted-foreground line-through",
};

export function BatchStatusBadge({ status }: { status: string }) {
  return <Badge variant="outline" className={TONE[status] ?? ""}>{status}</Badge>;
}
```

- [ ] **Step 2: Comparison table**

`dashboard/components/comparison-table.tsx`:

```tsx
import Link from "next/link";
import { RatingBadge } from "@/components/rating-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { sortForComparison, type ComparisonRow } from "@/lib/compare";
import { formatPrice } from "@/lib/format";

export function ComparisonTable({ rows }: { rows: ComparisonRow[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Ticker</TableHead>
          <TableHead>Rating</TableHead>
          <TableHead className="text-right">Price target</TableHead>
          <TableHead className="text-right">Stop</TableHead>
          <TableHead>Horizon</TableHead>
          <TableHead>TL;DR</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {sortForComparison(rows).map((r) => (
          <TableRow key={r.reportId}>
            <TableCell className="font-medium">
              <Link href={`/reports/${encodeURIComponent(r.reportId)}`} className="underline-offset-4 hover:underline">{r.ticker}</Link>
            </TableCell>
            <TableCell><RatingBadge rating={r.summary.rating} /></TableCell>
            <TableCell className="text-right">{formatPrice(r.summary.price_target)}</TableCell>
            <TableCell className="text-right">{formatPrice(r.summary.stop_loss)}</TableCell>
            <TableCell>{r.summary.time_horizon ?? "—"}</TableCell>
            <TableCell className="max-w-md text-sm">{r.summary.tldr}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
```

- [ ] **Step 3: New batch form + page**

`dashboard/components/new-batch-form.tsx`:

```tsx
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { todayLocal } from "@/lib/format";
import { ANALYSTS, ANALYST_LABELS, type Analyst } from "@/lib/types";

export function NewBatchForm() {
  const router = useRouter();
  const [tickers, setTickers] = useState("");
  const [tradeDate, setTradeDate] = useState(todayLocal());
  const [analysts, setAnalysts] = useState<Analyst[]>([...ANALYSTS]);
  const [debate, setDebate] = useState(1);
  const [risk, setRisk] = useState(1);
  const [autoSummarize, setAutoSummarize] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<{ message: string; activeBatchId?: string } | null>(null);

  const toggle = (a: Analyst, on: boolean) =>
    setAnalysts((cur) => (on ? [...new Set([...cur, a])] : cur.filter((x) => x !== a)));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const res = await fetch("/api/batches", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        tickers, trade_date: tradeDate, analysts,
        max_debate_rounds: debate, max_risk_discuss_rounds: risk, auto_summarize: autoSummarize,
      }),
    });
    const data = await res.json().catch(() => ({}));
    setPending(false);
    if (res.ok) router.push(`/batches/${data.id}`);
    else setError({ message: data.error ?? `Failed (${res.status})`, activeBatchId: data.activeBatchId });
  }

  return (
    <form onSubmit={submit} className="max-w-xl space-y-5">
      <div className="space-y-2">
        <Label htmlFor="tickers">Tickers</Label>
        <Textarea id="tickers" placeholder="NVDA, MSFT, BTC-USD" value={tickers} onChange={(e) => setTickers(e.target.value)} required />
        <p className="text-xs text-muted-foreground">Comma, space or newline separated. Up to 20. Runs one after another.</p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="date">Trade date</Label>
        <Input id="date" type="date" max={todayLocal()} value={tradeDate} onChange={(e) => setTradeDate(e.target.value)} className="w-48" required />
      </div>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Analysts</legend>
        <div className="flex flex-wrap gap-4">
          {ANALYSTS.map((a) => (
            <label key={a} className="flex items-center gap-2 text-sm">
              <Checkbox checked={analysts.includes(a)} onCheckedChange={(v) => toggle(a, v === true)} />
              {ANALYST_LABELS[a]}
            </label>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">Crypto tickers skip the Fundamentals analyst.</p>
      </fieldset>
      <div className="flex gap-6">
        <div className="space-y-2">
          <Label htmlFor="debate">Debate rounds</Label>
          <Input id="debate" type="number" min={1} max={5} value={debate} onChange={(e) => setDebate(Number(e.target.value))} className="w-24" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="risk">Risk rounds</Label>
          <Input id="risk" type="number" min={1} max={5} value={risk} onChange={(e) => setRisk(Number(e.target.value))} className="w-24" />
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <Checkbox checked={autoSummarize} onCheckedChange={(v) => setAutoSummarize(v === true)} />
        Summarize each report when it finishes
      </label>
      {error && (
        <p className="text-sm text-red-600">
          {error.message}
          {error.activeBatchId && (
            <> — <Link className="underline" href={`/batches/${error.activeBatchId}`}>view the running batch</Link></>
          )}
        </p>
      )}
      <Button type="submit" disabled={pending || analysts.length === 0}>
        {pending ? "Starting…" : "Start batch"}
      </Button>
    </form>
  );
}
```

`dashboard/app/batches/new/page.tsx`:

```tsx
import { NewBatchForm } from "@/components/new-batch-form";

export default function NewBatchPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">New batch</h1>
      <NewBatchForm />
    </div>
  );
}
```

- [ ] **Step 4: Batches list**

`dashboard/app/batches/page.tsx`:

```tsx
import Link from "next/link";
import { BatchStatusBadge } from "@/components/batch-status-badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { isOrphaned, listBatches } from "@/lib/batches";
import { formatIso } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function BatchesPage() {
  const batches = await listBatches();
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Batches</h1>
        <Button asChild><Link href="/batches/new">New batch</Link></Button>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Created</TableHead>
            <TableHead>Tickers</TableHead>
            <TableHead>Trade date</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Done / failed</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {batches.map((b) => (
            <TableRow key={b.id}>
              <TableCell><Link href={`/batches/${b.id}`} className="underline-offset-4 hover:underline">{formatIso(b.created_at)}</Link></TableCell>
              <TableCell>{b.params.tickers.join(", ")}</TableCell>
              <TableCell>{b.params.trade_date}</TableCell>
              <TableCell><BatchStatusBadge status={isOrphaned(b) ? "failed" : b.status} /></TableCell>
              <TableCell className="text-right">
                {b.items.filter((i) => i.status === "done").length} / {b.items.filter((i) => i.status === "failed").length}
              </TableCell>
            </TableRow>
          ))}
          {batches.length === 0 && (
            <TableRow><TableCell colSpan={5} className="py-8 text-center text-muted-foreground">No batches yet.</TableCell></TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
```

(If the generated shadcn `Button` does not support `asChild`, wrap instead: `<Link href="/batches/new" className={buttonVariants()}>New batch</Link>` importing `buttonVariants` from `@/components/ui/button`.)

- [ ] **Step 5: Batch detail**

`dashboard/app/batches/[id]/page.tsx`:

```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { AutoRefresh } from "@/components/auto-refresh";
import { BatchStatusBadge } from "@/components/batch-status-badge";
import { CancelBatchButton } from "@/components/cancel-batch-button";
import { ComparisonTable } from "@/components/comparison-table";
import { RatingBadge } from "@/components/rating-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getBatch, isActive, isOrphaned, readLogTail } from "@/lib/batches";
import type { ComparisonRow } from "@/lib/compare";
import { formatIso } from "@/lib/format";
import { NotFoundError } from "@/lib/paths";
import { readSummaryForReport } from "@/lib/reports";
import { ANALYST_LABELS, type Batch } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function BatchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let batch: Batch;
  try {
    batch = await getBatch(id);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const active = isActive(batch);
  const orphaned = isOrphaned(batch);
  const log = await readLogTail(id);

  const rows: ComparisonRow[] = [];
  for (const item of batch.items) {
    if (!item.report_id) continue;
    const summary = await readSummaryForReport(item.report_id);
    if (summary) rows.push({ ticker: item.ticker, reportId: item.report_id, summary });
  }

  const p = batch.params;
  return (
    <div className="space-y-6">
      <AutoRefresh active={active} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="flex items-center gap-3 text-2xl font-semibold">
          Batch {formatIso(batch.created_at)} <BatchStatusBadge status={orphaned ? "failed" : batch.status} />
        </h1>
        {active && batch.pid != null && <CancelBatchButton batchId={batch.id} />}
        {orphaned && <CancelBatchButton batchId={batch.id} label="Mark as failed" />}
      </div>
      <p className="text-sm text-muted-foreground">
        Trade date {p.trade_date} · Analysts {p.analysts.map((a) => ANALYST_LABELS[a]).join(", ")} · Debate {p.max_debate_rounds} · Risk {p.max_risk_discuss_rounds}
        {p.auto_summarize ? " · Auto-summarize" : ""}
      </p>
      {orphaned && <p className="text-sm text-red-600">The worker process exited unexpectedly. Check the log below.</p>}
      {batch.error && <p className="text-sm text-red-600">{batch.error}</p>}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Ticker</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Signal</TableHead>
            <TableHead>Summary</TableHead>
            <TableHead>Finished</TableHead>
            <TableHead>Report / error</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {batch.items.map((item) => (
            <TableRow key={item.ticker}>
              <TableCell className="font-medium">{item.ticker}</TableCell>
              <TableCell><BatchStatusBadge status={item.status} /></TableCell>
              <TableCell><RatingBadge rating={item.signal} /></TableCell>
              <TableCell className="text-sm">{item.summary_status}</TableCell>
              <TableCell className="whitespace-nowrap text-sm">{formatIso(item.finished_at)}</TableCell>
              <TableCell className="max-w-md text-sm">
                {item.report_id && (
                  <Link href={`/reports/${encodeURIComponent(item.report_id)}`} className="underline">Open report</Link>
                )}
                {item.error && <div className="text-red-600">{item.error}</div>}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {rows.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-lg font-semibold">Comparison</h2>
          <ComparisonTable rows={rows} />
        </section>
      )}

      {log && (
        <details>
          <summary className="cursor-pointer text-sm text-muted-foreground">Worker log (last 50 lines)</summary>
          <pre className="mt-2 max-h-96 overflow-auto rounded bg-muted p-3 text-xs">{log}</pre>
        </details>
      )}
    </div>
  );
}
```

`dashboard/app/batches/[id]/not-found.tsx`:

```tsx
import Link from "next/link";

export default function NotFound() {
  return (
    <div className="space-y-2">
      <h1 className="text-xl font-semibold">Batch not found</h1>
      <Link href="/batches" className="underline">Back to batches</Link>
    </div>
  );
}
```

- [ ] **Step 6: Verify**

Run: `cd dashboard && pnpm exec tsc --noEmit && pnpm lint && pnpm build && pnpm test`
Expected: all clean. Then with `pnpm dev`: `/batches/new` renders the form; submitting `../x` shows the validation error inline; `/batches` lists the batch files in `../reports/_batches` (empty initially).

- [ ] **Step 7: Commit**

```bash
git add dashboard
git commit -m "feat(dashboard): add batch pages with live status and comparison table"
```

---

### Task 9: README + end-to-end run

**Files:**
- Create: `dashboard/README.md` (replace the create-next-app README)
- Modify: `README.md` (root) — add a short "Dashboard" subsection under "Installation and CLI"

- [ ] **Step 1: Write `dashboard/README.md`**

````markdown
# TradingAgents Dashboard

A local web UI for TradingAgents: browse saved reports, run analyses for several tickers as one batch, and get LLM summaries with a per-batch comparison table.

## Setup

Requires the repo's Python environment (`.venv` with `tradingagents` installed) and your provider settings in the repo `.env` (the same ones the CLI uses: `TRADINGAGENTS_LLM_PROVIDER`, `TRADINGAGENTS_QUICK_THINK_LLM`, API keys, ...).

```bash
cd dashboard
pnpm install
pnpm dev          # http://localhost:3000
```

Optional env vars (see `.env.example`): `TA_REPO_ROOT`, `TA_PYTHON` (default `../.venv/bin/python`), `TA_REPORTS_DIR` (default `../reports`).

## How it works

- Reports are read from `reports/<TICKER>_<YYYYMMDD_HHMMSS>/`, the same folders the CLI writes.
- **New batch** starts `python -m dashboard.worker.run_batch <id>` in the background. It runs the tickers one after another and records progress in `reports/_batches/<id>.json` (log: `<id>.log`). Only one batch runs at a time; closing the browser or restarting the dev server doesn't stop it. **Cancel** sends it SIGTERM.
- **Summaries** come from your configured quick-think model and are saved as `summary.json` in each report folder. The batch page's comparison table is built from those files.

## Tests

```bash
pnpm test                                          # TypeScript (vitest)
cd .. && .venv/bin/python -m pytest dashboard/worker/tests -q   # Python worker
```
````

- [ ] **Step 2: Add a root README pointer**

In the root `README.md`, directly before the `### Required APIs` heading, insert:

```markdown
### Web dashboard

A local Next.js dashboard for browsing reports, running multi-ticker batches and summarizing results lives in [`dashboard/`](dashboard/README.md).

```

- [ ] **Step 3: Full test pass**

Run: `cd dashboard && pnpm test && cd .. && .venv/bin/python -m pytest dashboard/worker/tests -q && .venv/bin/python -m pytest tests -q -x`
Expected: all green (the root suite confirms nothing in `tradingagents/` regressed).

- [ ] **Step 4: Manual end-to-end with the real LLM (uses API quota — one ticker, one analyst)**

1. `cd dashboard && pnpm dev`
2. On an existing report (e.g. SPY), click **Summarize** → a summary card appears within ~30 s; `reports/SPY_…/summary.json` exists.
3. **New batch**: tickers `SPY`, analysts **Market** only, rounds 1, auto-summarize on → you're redirected to the batch page, status `running`, refreshing every 3 s.
4. Wait for completion: item `done`, signal badge set, summary `done`, a comparison table with one row, the report opens from the link.
5. Start a second batch while one runs → inline 409 message with a link to the running batch.
6. Start a 2-ticker batch and click **Cancel** during the first ticker → batch `cancelled`, items `cancelled`.

Record any deviations; fix them before committing.

- [ ] **Step 5: Commit**

```bash
git add dashboard/README.md README.md
git commit -m "docs(dashboard): add dashboard README and root pointer"
```
