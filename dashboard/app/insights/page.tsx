import { AlphaChart } from "@/components/charts/alpha-chart";
import { HitRateChart } from "@/components/charts/hit-rate-chart";
import { RunsPerWeekChart } from "@/components/charts/runs-per-week-chart";
import { PriceFreshness } from "@/components/price-freshness";
import { runsPerWeek } from "@/lib/calendar";
import { formatRate, todayLocal } from "@/lib/format";
import { pricesStale, readPriceIndex } from "@/lib/prices";
import { listReports } from "@/lib/reports";
import { loadScorecards, summarizeScorecards, type MeasureStats } from "@/lib/scorecard";

export const dynamic = "force-dynamic";

function Counts({ s }: { s: MeasureStats }) {
  return (
    <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
      <div className="flex gap-1.5"><dt className="text-muted-foreground">Right</dt><dd className="font-semibold">{s.right}</dd></div>
      <div className="flex gap-1.5"><dt className="text-muted-foreground">Wrong</dt><dd className="font-semibold">{s.wrong}</dd></div>
      <div className="flex gap-1.5"><dt className="text-muted-foreground">Open</dt><dd className="font-semibold">{s.pending}</dd></div>
      <div className="flex gap-1.5"><dt className="text-muted-foreground">Not counted</dt><dd className="font-semibold">{s.notCounted}</dd></div>
    </dl>
  );
}

export default async function InsightsPage() {
  const [reports, index] = await Promise.all([listReports(), readPriceIndex()]);
  const cards = await loadScorecards({ reports });
  const summary = summarizeScorecards(cards);
  const weeks = runsPerWeek(reports.map((r) => r.runAt.slice(0, 10)), 26, todayLocal());

  return (
    <div className="space-y-16">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold tracking-[-0.03em]">Insights</h1>
          <p className="max-w-2xl text-muted-foreground">How the committee’s summarized verdicts played out against later prices.</p>
        </div>
        <PriceFreshness fetchedAt={index.fetched_at} stale={pricesStale(index)} errors={index.errors} />
      </div>

      {cards.length === 0 ? (
        <p className="max-w-xl text-muted-foreground">No summarized verdicts yet. Summarize reports on the Verdicts page to score them here.</p>
      ) : (
        <section className="grid gap-10 border-b border-border pb-12 lg:grid-cols-[1.4fr_1fr]">
          <div className="space-y-4">
            <p className="text-[clamp(4.5rem,11vw,8rem)] leading-[0.85] font-extrabold tracking-[-0.05em]">{formatRate(summary.levels.rate)}</p>
            <p className="text-lg font-semibold">reached the target before the stop</p>
            <Counts s={summary.levels} />
            {summary.levels.rate == null && (
              <p className="text-sm text-muted-foreground">No settled verdicts yet. A verdict settles when its target or stop is touched, or expires when its horizon ends.</p>
            )}
          </div>
          <div className="space-y-8">
            <div className="space-y-2">
              <p className="text-4xl font-bold tracking-[-0.03em]">{formatRate(summary.benchmark.rate)}</p>
              <p className="font-semibold">beat the benchmark after 20 trading days</p>
              <Counts s={summary.benchmark} />
            </div>
            <div className="space-y-2">
              <p className="text-4xl font-bold tracking-[-0.03em]">{formatRate(summary.absolute.rate)}</p>
              <p className="font-semibold">moved the way they were called after 20 trading days</p>
              <Counts s={summary.absolute} />
            </div>
          </div>
        </section>
      )}

      {cards.length > 0 && (
        <div className="grid gap-14 lg:grid-cols-2">
          <HitRateChart rows={summary.byRating} />
          <AlphaChart rows={summary.byRating} />
        </div>
      )}
      <RunsPerWeekChart weeks={weeks} />
    </div>
  );
}
