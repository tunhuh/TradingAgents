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
