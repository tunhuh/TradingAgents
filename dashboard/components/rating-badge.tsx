import { Badge } from "@/components/ui/badge";

const TONE: Record<string, string> = {
  Buy: "bg-emerald-600 text-white border-transparent",
  Overweight: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
  Hold: "bg-muted text-foreground",
  Underweight: "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200",
  Sell: "bg-red-600 text-white border-transparent",
  REVIEW: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
};

export function RatingBadge({ rating }: { rating: string | null | undefined }) {
  if (!rating) return <span className="text-muted-foreground">—</span>;
  return <Badge variant="outline" className={TONE[rating] ?? ""}>{rating}</Badge>;
}
