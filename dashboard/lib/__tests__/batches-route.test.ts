import { spawn, type ChildProcess } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST } from "@/app/api/batches/route";
import { createBatchRecord, writeBatch } from "@/lib/batches";

let dir: string;
const children: ChildProcess[] = [];
const post = (body: object) =>
  POST(new Request("http://localhost:3000/api/batches", {
    method: "POST",
    headers: { host: "localhost:3000", "content-type": "application/json" },
    body: JSON.stringify(body),
  }));
const body = { tickers: "NVDA", trade_date: "2026-10-03", analysts: ["market"] };

function fakePython(script: string) {
  const file = path.join(dir, "fake-python.sh");
  writeFileSync(file, `#!/bin/sh\n${script}\n`);
  chmodSync(file, 0o755);
  process.env.TA_PYTHON = file;
}
const batchFiles = () => readdirSync(path.join(dir, "_batches")).filter((f) => f.endsWith(".json"));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "ta-batches-route-"));
  process.env.TA_REPORTS_DIR = dir;
});
afterEach(() => {
  for (const c of children.splice(0)) c.kill("SIGKILL");
});

describe("POST /api/batches", () => {
  it("refuses a second batch while a live worker owns the first", async () => {
    const id = "20261005_090000_aaaa";
    // A live process whose command line is this batch's worker invocation.
    const worker = spawn("sh", ["-c", "sleep 30", "dashboard.worker.run_batch", id], { stdio: "ignore" });
    children.push(worker);
    const batch = createBatchRecord({ tickers: ["SPY"], trade_date: "2026-10-03", analysts: ["market"], max_debate_rounds: 1, max_risk_discuss_rounds: 1, auto_summarize: false }, id);
    batch.status = "running";
    batch.pid = worker.pid!;
    await writeBatch(batch);

    const res = await post(body);
    expect(res.status).toBe(409);
    expect((await res.json()).activeBatchId).toBe(id);
  });

  it("records the worker's pid at launch, so a worker that dies at startup frees the batch at once", async () => {
    fakePython("exit 1"); // dies before writing anything
    const first = await post(body);
    expect(first.status).toBe(201);
    const { id } = await first.json();
    const saved = JSON.parse(readFileSync(path.join(dir, "_batches", `${id}.json`), "utf-8"));
    expect(saved.pid).toEqual(expect.any(Number));
    await sleep(200);
    expect((await post(body)).status).toBe(201); // not a 409 for the next two minutes
    expect(batchFiles()).toHaveLength(2);
  });

  it("names TA_PYTHON when the worker can't be started", async () => {
    process.env.TA_PYTHON = path.join(dir, "no-such-python");
    const res = await post(body);
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/TA_PYTHON/);
  });
});
