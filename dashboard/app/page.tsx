import Link from "next/link";
import { ReportsTable } from "@/components/reports-table";
import { SummarizeAllButton } from "@/components/summarize-all-button";
import { Button } from "@/components/ui/button";
import { VerdictScale } from "@/components/verdict-scale";
import { formatDay, formatPrice } from "@/lib/format";
import { listReports } from "@/lib/reports";
import { groupByRating, latestPerTicker } from "@/lib/verdicts";

export const dynamic = "force-dynamic";

export default async function VerdictsPage() {
  const reports = await listReports();
  if (reports.length === 0) {
    return (
      <div className="max-w-xl space-y-4">
        <h1 className="text-3xl font-bold tracking-[-0.03em]">No reports yet</h1>
        <p className="text-muted-foreground">Start a batch to run the committee on your first tickers. Finished reports appear here.</p>
        <Button asChild><Link href="/batches/new">Start a batch</Link></Button>
      </div>
    );
  }

  const latest = latestPerTicker(reports);
  const { unrated } = groupByRating(latest, (r) => r.summary?.rating);
  const entries = latest
    .filter((r) => r.summary)
    .map((r) => ({
      key: r.id,
      ticker: r.ticker,
      href: `/reports/${encodeURIComponent(r.id)}`,
      rating: r.summary!.rating,
      note: r.summary!.price_target != null ? `${formatDay(r.runAt)}, target ${formatPrice(r.summary!.price_target)}` : formatDay(r.runAt),
    }));

  return (
    <div className="space-y-16">
      <section className="space-y-8">
        <div className="max-w-2xl space-y-2">
          <h1 className="text-3xl font-bold tracking-[-0.03em]">Latest verdicts</h1>
          <p className="text-muted-foreground">The most recent run of each ticker, placed by the Portfolio Manager’s rating.</p>
        </div>
        <VerdictScale entries={entries} label="Latest verdict per ticker, from Buy to Sell" />
        {unrated.length > 0 && (
          <div className="space-y-3 border-t border-border pt-6">
            <h2 className="font-semibold">Not summarized yet</h2>
            <p className="text-sm text-muted-foreground">A summary reads the rating from the report and places the ticker on the scale.</p>
            <ul className="flex flex-wrap gap-x-6 gap-y-1">
              {unrated.map((r) => (
                <li key={r.id}>
                  <Link href={`/reports/${encodeURIComponent(r.id)}`} className="text-xl font-bold tracking-[-0.03em] text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
                    {r.ticker}
                  </Link>
                </li>
              ))}
            </ul>
            <SummarizeAllButton reports={unrated.map((r) => ({ id: r.id, ticker: r.ticker }))} />
          </div>
        )}
      </section>
      <section className="space-y-4">
        <h2 className="text-xl font-bold tracking-[-0.02em]">All runs</h2>
        <ReportsTable reports={reports} />
      </section>
    </div>
  );
}
