import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { batchTradeDates, resolveTradeDate } from "@/lib/trade-dates";

let reports: string;
let logs: string;
beforeEach(() => {
  reports = mkdtempSync(path.join(os.tmpdir(), "ta-td-reports-"));
  logs = mkdtempSync(path.join(os.tmpdir(), "ta-td-logs-"));
  process.env.TA_REPORTS_DIR = reports;
  process.env.TA_RESULTS_DIR = logs;
});

const report = { id: "SPY_20261004_220413", ticker: "SPY", runAt: "2026-10-04T22:04:13" };

describe("resolveTradeDate", () => {
  it("prefers meta.json", async () => {
    mkdirSync(path.join(reports, report.id));
    writeFileSync(path.join(reports, report.id, "meta.json"), JSON.stringify({ trade_date: "2026-10-02" }));
    expect(await resolveTradeDate(report, new Map([[report.id, "2026-09-30"]]))).toEqual({ date: "2026-10-02", source: "meta" });
  });
  it("then the batch that produced the report", async () => {
    expect(await resolveTradeDate(report, new Map([[report.id, "2026-09-30"]]))).toEqual({ date: "2026-09-30", source: "batch" });
  });
  it("then the CLI log folder closest before the run, within 7 days, ignoring non-date folders", async () => {
    for (const d of ["2026-09-20", "2026-10-03", "2026-10-05", "TradingAgentsStrategy_logs"]) mkdirSync(path.join(logs, "SPY", d), { recursive: true });
    expect(await resolveTradeDate(report, new Map())).toEqual({ date: "2026-10-03", source: "cli-log" });
  });
  it("falls back to the run date", async () => {
    mkdirSync(path.join(logs, "SPY", "2026-09-20"), { recursive: true }); // outside the 7-day window
    expect(await resolveTradeDate(report, new Map())).toEqual({ date: "2026-10-04", source: "run-date" });
  });
});

describe("batchTradeDates", () => {
  it("maps report ids from batch files to their trade date", async () => {
    mkdirSync(path.join(reports, "_batches"));
    writeFileSync(path.join(reports, "_batches", "20261005_151023_6aca.json"), JSON.stringify({
      id: "20261005_151023_6aca", params: { trade_date: "2026-10-05" },
      items: [{ report_id: "SPY_20261005_151903" }, { report_id: null }],
    }));
    expect([...(await batchTradeDates())]).toEqual([["SPY_20261005_151903", "2026-10-05"]]);
  });
});
