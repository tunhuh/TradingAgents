import { mkdirSync, mkdtempSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { loadScorecards } from "@/lib/scorecard";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "ta-scorecard-"));
  process.env.TA_REPORTS_DIR = dir;
  process.env.TA_RESULTS_DIR = path.join(dir, "no-logs");
  for (const id of ["SPY_20261004_220413", "VOO_20261004_213424"]) {
    mkdirSync(path.join(dir, id));
    writeFileSync(path.join(dir, id, "complete_report.md"), "# r");
    const m = statSync(path.join(dir, id, "complete_report.md")).mtimeMs / 1000;
    writeFileSync(path.join(dir, id, "summary.json"), JSON.stringify({ rating: "Hold", price_target: 1, stop_loss: 1, time_horizon: null, tldr: "t", bull_points: [], key_risks: [], catalysts_to_watch: [], model: "m", generated_at: "2026-10-05T00:00:00Z", source_mtime: m }));
  }
});

describe("loadScorecards", () => {
  it("scores only the requested ticker", async () => {
    expect((await loadScorecards()).map((c) => c.report.ticker).sort()).toEqual(["SPY", "VOO"]);
    expect((await loadScorecards({ ticker: "VOO" })).map((c) => c.report.ticker)).toEqual(["VOO"]);
  });
});
