import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DELETE } from "@/app/api/batches/[id]/route";
import { createBatchRecord, writeBatch } from "@/lib/batches";

let dir: string;
let bystander: ChildProcess;
beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "ta-route-"));
  process.env.TA_REPORTS_DIR = dir;
  // An unrelated live process that happens to own the batch's recorded pid (pid reuse).
  bystander = spawn("sleep", ["30"], { stdio: "ignore" });
});
afterEach(() => {
  bystander.kill("SIGKILL");
});

describe("DELETE /api/batches/[id]", () => {
  it("never signals a live process that is not this batch's worker; marks the batch failed", async () => {
    const id = "20261005_090000_aaaa";
    const batch = createBatchRecord(
      { tickers: ["NVDA"], trade_date: "2026-10-03", analysts: ["market"], max_debate_rounds: 1, max_risk_discuss_rounds: 1, auto_summarize: false },
      id,
    );
    batch.status = "running";
    batch.pid = bystander.pid!;
    await writeBatch(batch);

    const res = await DELETE(new Request(`http://localhost:3000/api/batches/${id}`, { method: "DELETE", headers: { host: "localhost:3000" } }), {
      params: Promise.resolve({ id }),
    });

    expect(await res.json()).toMatchObject({ ok: true, action: "marked-failed" });
    expect(bystander.exitCode).toBeNull();
    expect(bystander.signalCode).toBeNull();
    expect(JSON.parse(readFileSync(path.join(dir, "_batches", `${id}.json`), "utf-8")).status).toBe("failed");
  });
});
