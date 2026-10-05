import Link from "next/link";
import { RATING_SWATCH } from "@/components/rating-tag";
import { cn } from "@/lib/utils";
import { groupByRating } from "@/lib/verdicts";

export interface ScaleEntry {
  key: string;
  ticker: string;
  href: string;
  rating: string;
  note?: string;
}

const HOVER_DECORATION: Record<string, string> = {
  Buy: "hover:decoration-rating-buy",
  Overweight: "hover:decoration-rating-overweight",
  Hold: "hover:decoration-rating-hold",
  Underweight: "hover:decoration-rating-underweight",
  Sell: "hover:decoration-rating-sell",
};

/**
 * The five-step rating scale with each ticker placed in its column. Stacks
 * into rows on narrow screens. Tickers settle into place once on load.
 */
export function VerdictScale({ entries, label }: { entries: ScaleEntry[]; label: string }) {
  const { columns } = groupByRating(entries, (e) => e.rating);
  return (
    <ol aria-label={label} className="grid gap-y-5 sm:grid-cols-5 sm:gap-x-4">
      {columns.map((col, c) => (
        <li key={col.rating} className="grid grid-cols-[0.375rem_1fr] gap-x-4 sm:block">
          <div aria-hidden className={cn("rounded-[2px] sm:h-2.5", RATING_SWATCH[col.rating])} />
          <div className="min-w-0">
            <h3 className="text-sm text-muted-foreground sm:mt-2.5">{col.rating}</h3>
            {col.items.length > 0 && (
              <ul className="mt-2 space-y-3 sm:mt-4 sm:space-y-4">
                {col.items.map((e, i) => (
                  <li
                    key={e.key}
                    className="animate-[settle_520ms_cubic-bezier(0.2,0.8,0.2,1)_both]"
                    style={{ animationDelay: `${c * 70 + i * 90}ms` }}
                  >
                    <Link
                      href={e.href}
                      className={cn(
                        "block text-[clamp(1.875rem,3.6vw,2.875rem)] leading-[0.95] font-extrabold tracking-[-0.045em] break-words underline decoration-transparent decoration-[3px] underline-offset-[5px]",
                        HOVER_DECORATION[col.rating],
                      )}
                    >
                      {e.ticker}
                    </Link>
                    {e.note && <span className="mt-1 block text-sm text-muted-foreground">{e.note}</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}
