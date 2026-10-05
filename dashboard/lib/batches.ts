import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { todayLocal, toLocalNaive } from "@/lib/format";
import { NotFoundError, batchesDir, resolveBatchFile } from "@/lib/paths";
import { parseTickerInput } from "@/lib/tickers";
import { ANALYSTS, type Analyst, type Batch, type BatchParams } from "@/lib/types";

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

  if (typeof b.tickers !== "string" && !Array.isArray(b.tickers)) return { ok: false, error: "tickers is required" };
  const { tickers, invalid } = parseTickerInput(b.tickers);
  if (invalid.length) return { ok: false, error: `Invalid ticker(s): ${invalid.join(", ")}` };
  if (tickers.length === 0) return { ok: false, error: "Enter at least one ticker" };
  if (tickers.length > MAX_TICKERS) return { ok: false, error: `At most ${MAX_TICKERS} tickers per batch` };

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
  const tmp = `${file}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`; // unique per writer
  await fs.writeFile(tmp, JSON.stringify(batch, null, 2), "utf-8");
  await fs.rename(tmp, file);
}

function isBatchShape(data: unknown, id: string): data is Batch {
  const b = data as Partial<Batch> | null;
  return !!b && typeof b === "object" && b.id === id && Array.isArray(b.items) && !!b.params && Array.isArray(b.params.tickers);
}

export async function getBatch(id: string): Promise<Batch> {
  const file = resolveBatchFile(id);
  let data: unknown;
  try {
    data = JSON.parse(await fs.readFile(file, "utf-8"));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT" || e instanceof SyntaxError) throw new NotFoundError(`Unknown batch: ${id}`);
    throw e;
  }
  // A hand-edited or foreign file must not crash the pages or block new batches.
  if (!isBatchShape(data, id)) throw new NotFoundError(`Unreadable batch: ${id}`);
  return data;
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

/**
 * Whether `pid` is this batch's run_batch worker. A bare liveness check is not
 * enough: after a crash or reboot the pid can belong to an unrelated process,
 * which would then block new batches and receive Cancel's SIGTERM.
 */
export function isWorkerProcess(pid: number, batchId: string, procRoot = "/proc"): boolean {
  let argv: string[];
  try {
    if (procRoot === "/proc" && !existsSync("/proc")) {
      argv = execFileSync("ps", ["-o", "args=", "-p", String(pid)], { encoding: "utf-8" }).trim().split(/\s+/);
    } else {
      argv = readFileSync(`${procRoot}/${pid}/cmdline`, "utf-8").split("\0");
    }
  } catch {
    return false; // no such process (ps exits non-zero too)
  }
  return argv.includes("dashboard.worker.run_batch") && argv.includes(batchId);
}

const isOpen = (b: Batch) => b.status === "queued" || b.status === "running";

type WorkerCheck = (pid: number, batchId: string) => boolean;

export function isActive(batch: Batch, now: number = Date.now(), alive: WorkerCheck = isWorkerProcess): boolean {
  if (!isOpen(batch)) return false;
  if (batch.pid == null) return now - Date.parse(batch.created_at) < QUEUED_GRACE_MS;
  return alive(batch.pid, batch.id);
}

/** Non-terminal status but the worker is gone (crashed, killed, machine rebooted). */
export function isOrphaned(batch: Batch, now: number = Date.now(), alive: WorkerCheck = isWorkerProcess): boolean {
  return isOpen(batch) && !isActive(batch, now, alive);
}

export async function findActiveBatch(): Promise<Batch | null> {
  return (await listBatches()).find((b) => isActive(b)) ?? null;
}

export function batchLogPath(id: string): string {
  return resolveBatchFile(id).replace(/\.json$/, ".log");
}

const LOG_TAIL_BYTES = 64 * 1024;

/** Last `lines` lines of the worker log, reading at most its final 64 KB (the page polls it). */
export async function readLogTail(id: string, lines = 50): Promise<string> {
  let handle: fs.FileHandle | undefined;
  try {
    handle = await fs.open(batchLogPath(id), "r");
    const { size } = await handle.stat();
    const start = Math.max(0, size - LOG_TAIL_BYTES);
    const buf = Buffer.alloc(size - start);
    await handle.read(buf, 0, buf.length, start);
    let text = buf.toString("utf-8");
    if (start > 0) text = text.slice(text.indexOf("\n") + 1); // drop the partial first line
    return text.split("\n").slice(-lines - 1).join("\n").trimEnd();
  } catch {
    return "";
  } finally {
    await handle?.close();
  }
}
