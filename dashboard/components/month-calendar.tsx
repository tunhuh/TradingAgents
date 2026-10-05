import Link from "next/link";
import { RATING_SWATCH } from "@/components/rating-tag";
import type { CalendarDay } from "@/lib/calendar";
import { cn } from "@/lib/utils";
import type { ReportListItem } from "@/lib/types";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MAX_TICKERS = 3;

function Swatch({ rating }: { rating: string | undefined }) {
  return (
    <span
      aria-hidden
      className={cn("inline-block size-2 shrink-0 rounded-[2px]", rating && RATING_SWATCH[rating] ? RATING_SWATCH[rating] : "border border-muted-foreground")}
    />
  );
}

export function MonthCalendar({
  weeks, runs, month, selected, today,
}: {
  weeks: CalendarDay[][];
  runs: Map<string, ReportListItem[]>;
  month: string;
  selected: string | null;
  today: string;
}) {
  return (
    <table className="w-full table-fixed border-collapse">
      <thead>
        <tr>
          {WEEKDAYS.map((d) => (
            <th key={d} scope="col" className="pb-2 text-left text-sm font-normal text-muted-foreground">{d}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {weeks.map((week) => (
          <tr key={week[0].date}>
            {week.map((day) => {
              const dayRuns = runs.get(day.date) ?? [];
              const label = `${day.day}${dayRuns.length ? `, ${dayRuns.length} run${dayRuns.length > 1 ? "s" : ""}` : ""}`;
              return (
                <td key={day.date} className="h-24 border border-border p-0 align-top sm:h-28">
                  <Link
                    href={`/calendar?month=${month}&day=${day.date}`}
                    aria-label={label}
                    aria-current={selected === day.date ? "date" : undefined}
                    className={cn(
                      "flex h-full flex-col gap-1 p-1.5 hover:bg-card sm:p-2",
                      !day.inMonth && "text-muted-foreground/60",
                      selected === day.date && "bg-card",
                    )}
                  >
                    <span className={cn("text-sm", day.date === today && "self-start rounded-full px-1.5 outline-2 outline-foreground")}>{day.day}</span>
                    {/* Wide screens: tickers with swatches. Phones: swatches and a count. */}
                    <span className="hidden flex-col gap-0.5 sm:flex">
                      {dayRuns.slice(0, MAX_TICKERS).map((r) => (
                        <span key={r.id} className="flex items-center gap-1.5 truncate text-sm font-semibold tracking-[-0.01em]">
                          <Swatch rating={r.summary?.rating} />
                          {r.ticker}
                        </span>
                      ))}
                      {dayRuns.length > MAX_TICKERS && <span className="text-xs text-muted-foreground">+{dayRuns.length - MAX_TICKERS} more</span>}
                    </span>
                    {dayRuns.length > 0 && (
                      <span className="flex flex-wrap items-center gap-1 sm:hidden">
                        {dayRuns.slice(0, 2).map((r) => <Swatch key={r.id} rating={r.summary?.rating} />)}
                        {dayRuns.length > 2 && <span className="text-xs">+{dayRuns.length - 2}</span>}
                      </span>
                    )}
                  </Link>
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
