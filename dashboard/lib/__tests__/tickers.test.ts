import { describe, expect, it } from "vitest";
import { parseTickerInput } from "@/lib/tickers";

describe("parseTickerInput", () => {
  it("upper-cases, splits on commas/spaces/semicolons/newlines, and dedupes in order", () => {
    expect(parseTickerInput("nvda, MSFT\nnvda ;btc-usd")).toEqual({ tickers: ["NVDA", "MSFT", "BTC-USD"], invalid: [] });
  });
  it("reports symbols that cannot be valid tickers", () => {
    expect(parseTickerInput("spy ../etc ...")).toEqual({ tickers: ["SPY"], invalid: ["../ETC", "..."] });
  });
  it("returns nothing for blank input", () => {
    expect(parseTickerInput("  , ")).toEqual({ tickers: [], invalid: [] });
  });
});
