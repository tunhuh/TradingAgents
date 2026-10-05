import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { NotFoundError, resolveBatchFile, resolveReportDir } from "@/lib/paths";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "ta-paths-"));
  process.env.TA_REPORTS_DIR = dir;
});

describe("resolveReportDir", () => {
  it("resolves a normal report id inside the reports dir", () => {
    expect(resolveReportDir("SPY_20261004_220413")).toBe(path.join(dir, "SPY_20261004_220413"));
    expect(resolveReportDir("^GSPC_20261004_220413")).toBe(path.join(dir, "^GSPC_20261004_220413"));
  });

  it.each(["..", ".", "../etc", "a/b", "_batches", "", "a\\b", "x/../../y"])("rejects %j", (id) => {
    expect(() => resolveReportDir(id)).toThrow(NotFoundError);
  });
});

describe("resolveBatchFile", () => {
  it("accepts a well-formed id", () => {
    expect(resolveBatchFile("20261005_101500_a1b2")).toBe(path.join(dir, "_batches", "20261005_101500_a1b2.json"));
  });
  it.each(["../x", "20261005_101500", "20261005_101500_ZZZZ"])("rejects %j", (id) => {
    expect(() => resolveBatchFile(id)).toThrow(NotFoundError);
  });
});
