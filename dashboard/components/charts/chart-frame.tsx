import type { ReactNode } from "react";

/** A titled chart with a disclosure that shows the same data as a table. */
export function ChartFrame({ title, description, table, children }: { title: string; description?: string; table: ReactNode; children: ReactNode }) {
  return (
    <figure className="space-y-3">
      <figcaption className="space-y-1">
        <h3 className="font-semibold">{title}</h3>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </figcaption>
      {children}
      <details>
        <summary className="cursor-pointer text-sm text-muted-foreground hover:text-foreground">Show table</summary>
        <div className="mt-3 overflow-x-auto">{table}</div>
      </details>
    </figure>
  );
}

export const tableClasses = {
  table: "w-full border-collapse text-sm",
  th: "py-2 pr-4 text-left font-normal text-muted-foreground",
  td: "border-t border-border py-2 pr-4",
};
