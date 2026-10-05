import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { pricesStale, readBars, readPriceIndex } from "@/lib/prices";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "ta-prices-"));
  process.env.TA_REPORTS_DIR = dir;
});

describe("price cache readers", () => {
  it("returns an empty index when missing or corrupt", async () => {
    expect(await readPriceIndex()).toEqual({ fetched_at: null, tickers: {}, errors: {} });
    mkdirSync(path.join(dir, "_prices"));
    writeFileSync(path.join(dir, "_prices", "_index.json"), "{ half");
    expect(await readPriceIndex()).toEqual({ fetched_at: null, tickers: {}, errors: {} });
  });
  it("reads bars by symbol, rejecting unsafe names", async () => {
    mkdirSync(path.join(dir, "_prices"));
    writeFileSync(path.join(dir, "_prices", "^N225.json"), JSON.stringify({ symbol: "^N225", bars: [{ date: "2026-10-02", high: 2, low: 1, close: 1.5 }] }));
    expect(await readBars("^N225")).toEqual([{ date: "2026-10-02", high: 2, low: 1, close: 1.5 }]);
    expect(await readBars("NOPE")).toBeNull();
    expect(await readBars("../x")).toBeNull();
  });
  it("is stale when never fetched or older than 12 hours", () => {
    const now = Date.parse("2026-10-05T12:00:00Z");
    expect(pricesStale({ fetched_at: null, tickers: {}, errors: {} }, now)).toBe(true);
    expect(pricesStale({ fetched_at: "2026-10-05T01:00:00Z", tickers: {}, errors: {} }, now)).toBe(false);
    expect(pricesStale({ fetched_at: "2026-10-04T23:00:00Z", tickers: {}, errors: {} }, now)).toBe(true);
  });
});
