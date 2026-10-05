import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { listBatches } from "@/lib/batches";
import { reportsDir } from "@/lib/paths";

export type TradeDateSource = "meta" | "batch" | "cli-log" | "run-date";
export interface TradeDate {
  date: string;
  source: TradeDateSource;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const CLI_LOG_WINDOW_DAYS = 7;

/** Where the CLI writes per-run logs: <results_dir>/<TICKER>/<trade date>/ (the framework's own override honoured). */
export function resultsDir(): string {
  return process.env.TA_RESULTS_DIR || process.env.TRADINGAGENTS_RESULTS_DIR || path.join(os.homedir(), ".tradingagents", "logs");
}

/** Per-ticker CLI log folder listings, shared across one page's reports. */
export type LogDirCache = Map<string, Promise<string[]>>;

export async function batchTradeDates(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (const batch of await listBatches()) {
    for (const item of batch.items ?? []) {
      if (item.report_id && DATE_RE.test(batch.params?.trade_date ?? "")) map.set(item.report_id, batch.params.trade_date);
    }
  }
  return map;
}

function minusDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

export async function resolveTradeDate(
  report: { id: string; ticker: string; runAt: string },
  batchMap: Map<string, string>,
  logDirs: LogDirCache = new Map(),
): Promise<TradeDate> {
  try {
    const meta = JSON.parse(await fs.readFile(path.join(reportsDir(), report.id, "meta.json"), "utf-8"));
    if (DATE_RE.test(meta?.trade_date ?? "")) return { date: meta.trade_date, source: "meta" };
  } catch {
    // no meta.json (older report) — fall through
  }

  const fromBatch = batchMap.get(report.id);
  if (fromBatch) return { date: fromBatch, source: "batch" };

  const runDate = report.runAt.slice(0, 10);
  try {
    const earliest = minusDays(runDate, CLI_LOG_WINDOW_DAYS);
    if (!logDirs.has(report.ticker)) logDirs.set(report.ticker, fs.readdir(path.join(resultsDir(), report.ticker)).catch(() => []));
    const dates = (await logDirs.get(report.ticker)!)
      .filter((d) => DATE_RE.test(d) && d <= runDate && d >= earliest)
      .sort();
    if (dates.length) return { date: dates[dates.length - 1], source: "cli-log" };
  } catch {
    // no CLI logs for this ticker
  }
  return { date: runDate, source: "run-date" };
}
