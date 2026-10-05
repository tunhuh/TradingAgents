import { formatIsoWhen } from "@/lib/format";
import type { ReportSummary } from "@/lib/types";

function Points({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div>
      <h3 className="text-sm font-semibold">{title}</h3>
      <ul className="mt-2 list-disc space-y-1.5 pl-4 text-[0.9375rem] leading-snug marker:text-muted-foreground">
        {items.map((text, i) => <li key={i}>{text}</li>)}
      </ul>
    </div>
  );
}

export function SummarySection({ summary, stale }: { summary: ReportSummary; stale: boolean }) {
  return (
    <section aria-label="Summary" className="mb-12 border-b border-border pb-10">
      <p className="max-w-[60ch] font-serif text-[1.375rem] leading-[1.5]">{summary.tldr}</p>
      <div className="mt-8 grid gap-6 sm:grid-cols-3">
        <Points title="Bull points" items={summary.bull_points} />
        <Points title="Key risks" items={summary.key_risks} />
        <Points title="Catalysts to watch" items={summary.catalysts_to_watch} />
      </div>
      <p className="mt-8 text-xs text-muted-foreground">
        Summarized by {summary.model} on {formatIsoWhen(summary.generated_at)}.
      </p>
      {stale && (
        <p className="mt-2 text-sm text-destructive">
          This report changed after it was summarized. Regenerate the summary to update it.
        </p>
      )}
    </section>
  );
}
