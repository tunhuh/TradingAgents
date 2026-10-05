const pad = (n: number) => String(n).padStart(2, "0");

/** Local wall-clock "YYYY-MM-DDTHH:MM:SS" — same shape as times parsed from report folder names. */
export function toLocalNaive(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function todayLocal(d: Date = new Date()): string {
  return toLocalNaive(d).slice(0, 10);
}

export function formatPrice(n: number | null | undefined): string {
  return n == null ? "—" : n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-10-04T22:04:13" → "4 Oct 2026, 22:04". Fixed month names so server and client render identically. */
export function formatWhen(runAt: string): string {
  const [date, time = "00:00"] = runAt.split("T");
  const [y, m, d] = date.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}, ${time.slice(0, 5)}`;
}

export function formatDay(runAt: string): string {
  return formatWhen(runAt).split(" ").slice(0, 2).join(" ");
}

/** UTC ISO timestamp → local "4 Oct 2026, 22:04". */
export function formatIsoWhen(iso: string | null | undefined): string {
  return iso ? formatWhen(toLocalNaive(new Date(iso))) : "—";
}

/** 0.0312 → "3.1%" (or "+3.1%" when signed). Uses a true minus sign. */
export function formatPercent(n: number | null | undefined, opts: { signed?: boolean; digits?: number } = {}): string {
  if (n == null) return "—";
  const text = Math.abs(n * 100).toFixed(opts.digits ?? 1) + "%";
  if (n < 0) return "−" + text;
  return opts.signed && n > 0 ? "+" + text : text;
}

/** Hit rate 0–1 → "67%". */
export function formatRate(n: number | null | undefined): string {
  return n == null ? "—" : `${Math.round(n * 100)}%`;
}
