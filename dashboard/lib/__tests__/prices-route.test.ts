import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { POST } from "@/app/api/prices/refresh/route";

let dir: string;
const local = () => new Request("http://localhost:3000/api/prices/refresh", { method: "POST", headers: { host: "localhost:3000" } });

/** A stand-in for python: records its args, then runs `body` (write an index, sleep, or fail). */
function fakePython(body: string) {
  const script = path.join(dir, "fake-python.sh");
  writeFileSync(script, `#!/bin/sh\necho "$@" > "$TA_REPORTS_DIR/args.txt"\n${body}\n`);
  chmodSync(script, 0o755);
  process.env.TA_PYTHON = script;
}

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), "ta-prices-route-"));
  process.env.TA_REPORTS_DIR = dir;
  for (const id of ["SPY_20261004_220413", "BTCUSD_20261004_220413", "NVDA q3 earnings", "earnings"]) mkdirSync(path.join(dir, id));
});

describe("POST /api/prices/refresh", () => {
  it("runs the worker for every reported ticker that is a valid symbol", async () => {
    fakePython(`mkdir -p "$TA_REPORTS_DIR/_prices"; echo '{"fetched_at":"2026-10-05T08:00:00Z","tickers":{},"errors":{}}' > "$TA_REPORTS_DIR/_prices/_index.json"`);
    const res = await POST(local());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ fetched_at: "2026-10-05T08:00:00Z", errors: {} });
    expect(readFileSync(path.join(dir, "args.txt"), "utf-8").trim()).toBe("-m dashboard.worker.prices BTCUSD SPY");
  });

  it("reports the worker's last error line", async () => {
    fakePython(`echo "ZZZZ: ValueError: no price data" >&2; exit 1`);
    const res = await POST(local());
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("ZZZZ: ValueError: no price data");
  });

  it("refuses a second refresh while one is running, and cross-site requests", async () => {
    fakePython("sleep 1");
    const first = POST(local());
    const second = await POST(local());
    expect(second.status).toBe(409);
    expect((await first).status).toBe(200);
    const cross = new Request("http://localhost:3000/api/prices/refresh", { method: "POST", headers: { host: "localhost:3000", "sec-fetch-site": "cross-site" } });
    expect((await POST(cross)).status).toBe(403);
  });
});

describe("POST /api/prices/refresh when python is missing", () => {
  it("names TA_PYTHON", async () => {
    process.env.TA_PYTHON = path.join(dir, "no-such-python");
    const res = await POST(local());
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/TA_PYTHON/);
  });
});
