// Pure calendar helpers. Dates are local wall-clock "YYYY-MM-DD"; arithmetic in UTC to avoid DST shifts.

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export interface CalendarDay {
  date: string;
  day: number;
  inMonth: boolean;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const utc = (date: string) => new Date(`${date}T00:00:00Z`);

export function parseMonth(s?: string): string | null {
  if (!s || !/^\d{4}-\d{2}$/.test(s)) return null;
  const m = Number(s.slice(5));
  return m >= 1 && m <= 12 ? s : null;
}

export function shiftMonth(month: string, delta: number): string {
  const d = utc(`${month}-01`);
  d.setUTCMonth(d.getUTCMonth() + delta);
  return iso(d).slice(0, 7);
}

export function monthLabel(month: string): string {
  return `${MONTH_NAMES[Number(month.slice(5)) - 1]} ${month.slice(0, 4)}`;
}

export function weekStart(date: string): string {
  const d = utc(date);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); // back to Monday
  return iso(d);
}

export function monthGrid(month: string): CalendarDay[][] {
  const next = `${shiftMonth(month, 1)}-01`;
  const cursor = utc(weekStart(`${month}-01`));
  const weeks: CalendarDay[][] = [];
  while (iso(cursor) < next) {
    const week: CalendarDay[] = [];
    for (let i = 0; i < 7; i++) {
      const date = iso(cursor);
      week.push({ date, day: cursor.getUTCDate(), inMonth: date.startsWith(month) });
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    weeks.push(week);
  }
  return weeks;
}

export function runsByDay<T extends { runAt: string }>(items: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const day = item.runAt.slice(0, 10);
    map.set(day, [...(map.get(day) ?? []), item]);
  }
  return map;
}

export function runsPerWeek(runDates: string[], weeks: number, today: string): { week: string; count: number }[] {
  const last = utc(weekStart(today));
  const out: { week: string; count: number }[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const d = new Date(last);
    d.setUTCDate(d.getUTCDate() - 7 * i);
    out.push({ week: iso(d), count: 0 });
  }
  const index = new Map(out.map((w, i) => [w.week, i]));
  for (const date of runDates) {
    const i = index.get(weekStart(date));
    if (i !== undefined) out[i].count++;
  }
  return out;
}
