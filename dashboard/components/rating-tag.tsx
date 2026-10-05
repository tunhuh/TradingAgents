import { cn } from "@/lib/utils";

export const RATING_SWATCH: Record<string, string> = {
  Buy: "bg-rating-buy",
  Overweight: "bg-rating-overweight",
  Hold: "bg-rating-hold",
  Underweight: "bg-rating-underweight",
  Sell: "bg-rating-sell",
};

/** A rating as text with its scale colour as a swatch; REVIEW (no parseable rating) gets a dashed outline. */
export function RatingTag({ rating, className }: { rating: string | null | undefined; className?: string }) {
  if (!rating) return <span className="text-muted-foreground">—</span>;
  return (
    // Swatch positioned absolutely so the label text sets the baseline.
    <span className={cn("relative inline-block pl-[1.1em] font-medium whitespace-nowrap", className)}>
      <span
        aria-hidden
        className={cn("absolute top-1/2 left-0 size-[0.6em] -translate-y-1/2 rounded-[2px]", RATING_SWATCH[rating] ?? "border border-dashed border-foreground")}
      />
      {rating === "REVIEW" ? "Needs review" : rating}
    </span>
  );
}
