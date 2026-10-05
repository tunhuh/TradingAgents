import { NextResponse } from "next/server";
import { localRequestError } from "@/lib/guard";
import { readPriceIndex } from "@/lib/prices";
import { pythonBin } from "@/lib/paths";
import { lastLine, runWorker } from "@/lib/python";
import { listReports, parseReportFolderName } from "@/lib/reports";

// Only folders named like the CLI's <TICKER>_<YYYYMMDD>_<HHMMSS>; custom save paths
// ("earnings", "NVDA q3") aren't market symbols.
const SYMBOL_RE = /^[A-Za-z0-9.\-^=+]{1,32}$/;
let running = false; // one refresh at a time per server process

export async function POST(req: Request) {
  const denied = localRequestError(req);
  if (denied) return NextResponse.json({ error: denied }, { status: 403 });
  if (running) return NextResponse.json({ error: "Prices are already refreshing." }, { status: 409 });

  running = true;
  try {
    const named = (await listReports()).filter((r) => parseReportFolderName(r.id).runAt !== null);
    const tickers = [...new Set(named.map((r) => r.ticker))].filter((t) => SYMBOL_RE.test(t)).sort();
    if (!tickers.length) return NextResponse.json({ fetched_at: null, errors: {} });
    let result;
    try {
      result = await runWorker("dashboard.worker.prices", tickers, 120_000);
    } catch (e) {
      return NextResponse.json({ error: `Could not start the Python worker (${pythonBin()}): ${(e as Error).message}. Set TA_PYTHON.` }, { status: 500 });
    }
    const index = await readPriceIndex();
    if (result.code !== 0) {
      return NextResponse.json({ error: lastLine(result.stderr) || `Price worker exited with code ${result.code}`, errors: index.errors }, { status: 500 });
    }
    return NextResponse.json({ fetched_at: index.fetched_at, errors: index.errors });
  } finally {
    running = false;
  }
}
