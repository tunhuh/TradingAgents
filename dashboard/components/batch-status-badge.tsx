import { Badge } from "@/components/ui/badge";

const TONE: Record<string, string> = {
  queued: "bg-muted text-foreground",
  pending: "bg-muted text-muted-foreground",
  running: "bg-blue-100 text-blue-900 dark:bg-blue-950 dark:text-blue-200",
  done: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
  partial: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  failed: "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200",
  cancelled: "bg-muted text-muted-foreground line-through",
};

export function BatchStatusBadge({ status }: { status: string }) {
  return <Badge variant="outline" className={TONE[status] ?? ""}>{status}</Badge>;
}
