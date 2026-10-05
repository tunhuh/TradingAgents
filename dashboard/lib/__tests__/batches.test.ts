import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  createBatchRecord, getBatch, isActive, isOrphaned, isWorkerProcess, listBatches, newBatchId, readLogTail, validateParams, writeBatch,
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

describe("isWorkerProcess", () => {
  const procWith = (pid: number, argv: string[]) => {
    const root = mkdtempSync(path.join(os.tmpdir(), "ta-proc-"));
    mkdirSync(path.join(root, String(pid)));
    writeFileSync(path.join(root, String(pid), "cmdline"), argv.join("\0") + "\0");
    return root;
  };

  it("recognizes this batch's run_batch worker", () => {
    const root = procWith(42, ["/repo/.venv/bin/python", "-m", "dashboard.worker.run_batch", "20261005_090000_aaaa"]);
    expect(isWorkerProcess(42, "20261005_090000_aaaa", root)).toBe(true);
  });
  it("rejects a reused pid running something else, or another batch's worker", () => {
    expect(isWorkerProcess(42, "20261005_090000_aaaa", procWith(42, ["node", "next-server"]))).toBe(false);
    const other = procWith(42, ["python", "-m", "dashboard.worker.run_batch", "20261005_090000_bbbb"]);
    expect(isWorkerProcess(42, "20261005_090000_aaaa", other)).toBe(false);
  });
  it("treats a missing process as not a worker", () => {
    expect(isWorkerProcess(42, "20261005_090000_aaaa", mkdtempSync(path.join(os.tmpdir(), "ta-proc-")))).toBe(false);
  });
});

describe("robustness", () => {
  const params = { tickers: ["NVDA"], trade_date: "2026-10-03", analysts: ["market" as const], max_debate_rounds: 1, max_risk_discuss_rounds: 1, auto_summarize: false };

  it("concurrent writes of one batch never collide on a temp file", async () => {
    const batch = createBatchRecord(params, "20261005_090000_aaaa");
    await expect(Promise.all(Array.from({ length: 30 }, () => writeBatch(batch)))).resolves.toBeDefined();
  });

  it("skips and 404s a batch file whose JSON is the wrong shape", async () => {
    mkdirSync(path.join(dir, "_batches"), { recursive: true });
    writeFileSync(path.join(dir, "_batches", "20261005_100000_cccc.json"), "{}");
    await writeBatch(createBatchRecord(params, "20261005_090000_bbbb"));
    expect((await listBatches()).map((b) => b.id)).toEqual(["20261005_090000_bbbb"]);
    await expect(getBatch("20261005_100000_cccc")).rejects.toThrow(NotFoundError);
  });

  it("reads only the end of a large worker log", async () => {
    mkdirSync(path.join(dir, "_batches"), { recursive: true });
    const lines = Array.from({ length: 2000 }, (_, i) => `line ${String(i).padStart(4, "0")} ${"x".repeat(88)}`);
    writeFileSync(path.join(dir, "_batches", "20261005_090000_aaaa.log"), lines.join("\n") + "\n");
    const tail = (await readLogTail("20261005_090000_aaaa", 1000)).split("\n");
    expect(tail.at(-1)).toBe(lines.at(-1));
    expect(tail.length).toBeLessThan(1000); // bounded read: ~64 KB of 100-byte lines
    expect(tail[0]).toMatch(/^line \d{4} /); // never starts mid-line
  });
});
