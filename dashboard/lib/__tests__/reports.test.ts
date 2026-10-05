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

describe("hasReport", () => {
  it("is false for a folder without complete_report.md", async () => {
    makeReport("SPY_20261004_220413");
    mkdirSync(path.join(dir, "EMPTY_20261004_220413"));
    const items = await listReports();
    expect(items.find((r) => r.id === "SPY_20261004_220413")!.hasReport).toBe(true);
    expect(items.find((r) => r.id === "EMPTY_20261004_220413")!.hasReport).toBe(false);
  });
});
