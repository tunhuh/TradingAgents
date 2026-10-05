const pad = (n: number) => String(n).padStart(2, "0");

/** Local wall-clock "YYYY-MM-DDTHH:MM:SS" — same shape as times parsed from report folder names. */
export function toLocalNaive(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function todayLocal(d: Date = new Date()): string {
  return toLocalNaive(d).slice(0, 10);
}

export function formatRunAt(runAt: string): string {
  return runAt.replace("T", " ").slice(0, 16);
}

export function formatPrice(n: number | null | undefined): string {
  return n == null ? "—" : n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

export function formatIso(iso: string | null | undefined): string {
  return iso ? toLocalNaive(new Date(iso)).replace("T", " ") : "—";
}
