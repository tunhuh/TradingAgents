import { cn } from "@/lib/utils";

const MARK: Record<string, { dot: string; label: string }> = {
  queued: { dot: "border border-muted-foreground", label: "Starting" },
  pending: { dot: "border border-muted-foreground", label: "Waiting" },
  running: { dot: "bg-rating-buy animate-[pulse-dot_1.4s_ease-in-out_infinite]", label: "Running" },
  done: { dot: "bg-foreground", label: "Done" },
  partial: { dot: "bg-rating-underweight", label: "Partly done" },
  failed: { dot: "bg-destructive", label: "Failed" },
  cancelled: { dot: "border border-dashed border-muted-foreground", label: "Cancelled" },
};

export function StatusMark({ status, className }: { status: string; className?: string }) {
  const mark = MARK[status] ?? { dot: "border border-muted-foreground", label: status };
  return (
    // Dot positioned absolutely so the label text, not the empty dot, sets the baseline.
    <span className={cn("relative inline-block pl-4 whitespace-nowrap", className)}>
      <span aria-hidden className={cn("absolute top-1/2 left-0 size-2 -translate-y-1/2 rounded-full", mark.dot)} />
      {mark.label}
    </span>
  );
}
