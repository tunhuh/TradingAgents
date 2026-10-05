import { RATING_SWATCH } from "@/components/rating-tag";
import { cn } from "@/lib/utils";
import { RATINGS } from "@/lib/types";

/** Compact five-step scale with the given rating's step raised and filled. */
export function RatingScaleMarker({ rating }: { rating: string }) {
  const index = (RATINGS as readonly string[]).indexOf(rating);
  return (
    <div role="img" aria-label={index >= 0 ? `${rating}, step ${index + 1} of 5 from Buy to Sell` : rating}>
      <div className="flex items-end gap-1">
        {RATINGS.map((r, i) => (
          <span
            key={r}
            className={cn(
              "h-2 flex-1 rounded-[2px]",
              i === index ? cn("h-5", RATING_SWATCH[r]) : "bg-border",
            )}
          />
        ))}
      </div>
      <div className="mt-2 flex justify-between text-xs text-muted-foreground">
        <span>Buy</span>
        <span>Sell</span>
      </div>
    </div>
  );
}
