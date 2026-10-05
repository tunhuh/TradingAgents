import { RatingBadge } from "@/components/rating-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatIso, formatPrice } from "@/lib/format";
import type { ReportSummary } from "@/lib/types";

function List({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div>
      <h3 className="mb-1 text-sm font-medium">{title}</h3>
      <ul className="list-disc space-y-1 pl-5 text-sm">{items.map((i) => <li key={i}>{i}</li>)}</ul>
    </div>
  );
}

export function SummaryCard({ summary, stale }: { summary: ReportSummary; stale: boolean }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-3 text-base">
          <RatingBadge rating={summary.rating} />
          <span>Target {formatPrice(summary.price_target)}</span>
          <span>Stop {formatPrice(summary.stop_loss)}</span>
          <span>{summary.time_horizon ?? "—"}</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p>{summary.tldr}</p>
        <div className="grid gap-4 md:grid-cols-3">
          <List title="Bull points" items={summary.bull_points} />
          <List title="Key risks" items={summary.key_risks} />
          <List title="Catalysts to watch" items={summary.catalysts_to_watch} />
        </div>
        <p className="text-xs text-muted-foreground">
          {summary.model} · {formatIso(summary.generated_at)}
          {stale && <span className="ml-2 text-amber-600">Stale: the report changed after this summary was written.</span>}
        </p>
      </CardContent>
    </Card>
  );
}
