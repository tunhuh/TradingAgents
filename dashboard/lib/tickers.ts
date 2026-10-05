// Client-safe: shared by the new-batch preview and server-side validation.
const TICKER_RE = /^[A-Z0-9.\-^=]{1,32}$/;

export function parseTickerInput(input: string | unknown[]): { tickers: string[]; invalid: string[] } {
  const raw = typeof input === "string" ? input.split(/[\s,;]+/) : input;
  const symbols = [...new Set(raw.map((t) => String(t).trim().toUpperCase()).filter(Boolean))];
  const isValid = (t: string) => TICKER_RE.test(t) && !/^\.+$/.test(t);
  return { tickers: symbols.filter(isValid), invalid: symbols.filter((t) => !isValid(t)) };
}
