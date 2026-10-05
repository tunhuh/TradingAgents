import type { ReactNode } from "react";

export function ChartTooltipBox({ children }: { children: ReactNode }) {
  return <div className="rounded-[3px] border border-border bg-card px-3 py-2 text-sm text-foreground shadow-sm">{children}</div>;
}
