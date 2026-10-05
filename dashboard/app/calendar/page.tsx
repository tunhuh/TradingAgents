import Link from "next/link";
import { MonthCalendar } from "@/components/month-calendar";
import { RatingTag } from "@/components/rating-tag";
import { monthGrid, monthLabel, parseDay, parseMonth, runsByDay, shiftMonth } from "@/lib/calendar";
import { formatWhen, todayLocal } from "@/lib/format";
import { listReports } from "@/lib/reports";

export const dynamic = "force-dynamic";

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ month?: string; day?: string }> }) {
  const sp = await searchParams;
  const reports = await listReports();
  const today = todayLocal();
  const month = parseMonth(sp.month) ?? (reports[0]?.runAt.slice(0, 7) ?? today.slice(0, 7));
  const day = parseDay(sp.day);
  const runs = runsByDay(reports);
  const dayRuns = day ? runs.get(day) ?? [] : [];

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold tracking-[-0.03em]">{monthLabel(month)}</h1>
          <p className="text-muted-foreground">Reports by the day they ran.</p>
        </div>
        <nav aria-label="Month" className="flex gap-4 text-sm">
          <Link href={`/calendar?month=${shiftMonth(month, -1)}`} className="underline-offset-4 hover:underline">Previous month</Link>
          <Link href={`/calendar?month=${shiftMonth(month, 1)}`} className="underline-offset-4 hover:underline">Next month</Link>
        </nav>
      </div>
      <MonthCalendar weeks={monthGrid(month)} runs={runs} month={month} selected={day} today={today} />
      {day && (
        <section className="space-y-3">
          <h2 className="text-xl font-bold tracking-[-0.02em]">{formatWhen(`${day}T00:00`).replace(", 00:00", "")}</h2>
          {dayRuns.length === 0 ? (
            <p className="text-muted-foreground">No reports ran on this day.</p>
          ) : (
            <ul>
              {dayRuns.map((r) => (
                <li key={r.id} className="flex flex-wrap items-baseline gap-x-5 border-t border-border py-3">
                  <Link href={`/reports/${encodeURIComponent(r.id)}`} className="text-lg font-bold tracking-[-0.02em] underline-offset-4 hover:underline">{r.ticker}</Link>
                  <span className="text-muted-foreground">{formatWhen(r.runAt).split(", ")[1]}</span>
                  <RatingTag rating={r.summary?.rating} />
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
