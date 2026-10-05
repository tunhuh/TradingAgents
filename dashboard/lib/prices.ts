import fs from "node:fs/promises";
import path from "node:path";
import type { Bar } from "@/lib/outcomes";
import { reportsDir } from "@/lib/paths";

export interface PriceIndex {
  fetched_at: string | null;
  tickers: Record<string, { symbol: string; benchmark: string }>;
  errors: Record<string, string>;
}

const STALE_MS = 12 * 60 * 60 * 1000;
const SYMBOL_RE = /^[A-Za-z0-9._\-^=+]+$/;

export function pricesDir(): string {
  return path.join(reportsDir(), "_prices");
}

export async function readPriceIndex(): Promise<PriceIndex> {
  try {
    const data = JSON.parse(await fs.readFile(path.join(pricesDir(), "_index.json"), "utf-8"));
    if (data && typeof data.tickers === "object" && typeof data.errors === "object") {
      return { fetched_at: data.fetched_at ?? null, tickers: data.tickers, errors: data.errors };
    }
  } catch {
    // missing or half-written index
  }
  return { fetched_at: null, tickers: {}, errors: {} };
}

export async function readBars(symbol: string): Promise<Bar[] | null> {
  if (!SYMBOL_RE.test(symbol) || /^\.+$/.test(symbol)) return null;
  try {
    const data = JSON.parse(await fs.readFile(path.join(pricesDir(), `${symbol}.json`), "utf-8"));
    return Array.isArray(data?.bars) ? (data.bars as Bar[]) : null;
  } catch {
    return null;
  }
}

export function pricesStale(index: PriceIndex, now: number = Date.now()): boolean {
  return !index.fetched_at || now - Date.parse(index.fetched_at) > STALE_MS;
}
