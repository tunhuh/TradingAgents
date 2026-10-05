import { NextResponse } from "next/server";
import { localRequestError } from "@/lib/guard";
import { readPriceIndex } from "@/lib/prices";
import { lastLine, runWorker } from "@/lib/python";
import { listReports } from "@/lib/reports";

// Folder names that aren't market symbols (custom CLI save paths) are skipped.
const SYMBOL_RE = /^[A-Za-z0-9.\-^=+]{1,32}$/;
let running = false; // one refresh at a time per server process

export async function POST(req: Request) {
  const denied = localRequestError(req);
  if (denied) return NextResponse.json({ error: denied }, { status: 403 });
  if (running) return NextResponse.json({ error: "Prices are already refreshing." }, { status: 409 });

  running = true;
  try {
    const tickers = [...new Set((await listReports()).map((r) => r.ticker))].filter((t) => SYMBOL_RE.test(t)).sort();
    if (!tickers.length) return NextResponse.json({ fetched_at: null, errors: {} });
    let result;
    try {
      result = await runWorker("dashboard.worker.prices", tickers, 120_000);
    } catch (e) {
      return NextResponse.json({ error: `Could not start the Python worker: ${(e as Error).message}` }, { status: 500 });
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
