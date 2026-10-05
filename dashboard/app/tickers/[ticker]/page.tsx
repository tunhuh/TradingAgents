import Link from "next/link";
import { notFound } from "next/navigation";
import { ChartFrame, tableClasses } from "@/components/charts/chart-frame";
import { PriceChart } from "@/components/charts/price-chart";
import { RatingHistoryChart } from "@/components/charts/rating-history-chart";
import { PriceFreshness } from "@/components/price-freshness";
import { RatingScaleMarker } from "@/components/rating-scale-marker";
import { RatingTag } from "@/components/rating-tag";
import { RunsTable } from "@/components/runs-table";
import { formatDay, formatPrice } from "@/lib/format";
import { NotFoundError, decodeRouteParam } from "@/lib/paths";
import { pricesStale, readBars, readPriceIndex } from "@/lib/prices";
import { listReports } from "@/lib/reports";
import { loadScorecards } from "@/lib/scorecard";
import { buildPriceSeries } from "@/lib/ticker-series";

export const dynamic = "force-dynamic";

export default async function TickerPage({ params, searchParams }: { params: Promise<{ ticker: string }>; searchParams: Promise<{ run?: string }> }) {
  let ticker: string;
  try {
    ticker = decodeRouteParam((await params).ticker);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const all = await listReports();
  const reports = all.filter((r) => r.ticker === ticker);
  if (!reports.length) notFound();

  const cards = (await loadScorecards({ reports: all, ticker })).sort((a, b) => b.report.runAt.localeCompare(a.report.runAt));
  const index = await readPriceIndex();
  const mapping = index.tickers[ticker];
  const bars = mapping ? await readBars(mapping.symbol) : null;
  const series = bars ? buildPriceSeries(bars, cards) : [];
  const runId = (await searchParams).run;
  const selected = cards.find((c) => c.report.id === runId) ?? cards[0] ?? null;
  const latest = reports[0];
  const priceError = mapping ? index.errors[mapping.symbol] ?? (bars ? null : "No price data for this ticker.") : "Prices haven't been fetched for this ticker yet.";

  return (
    <div className="space-y-12">
      <header className="grid gap-8 border-b border-border pb-10 lg:grid-cols-[1fr_22rem] lg:items-end">
        <div>
          <h1 className="text-[clamp(4.5rem,13vw,9rem)] leading-[0.82] font-extrabold tracking-[-0.055em] break-words">{ticker}</h1>
          <p className="mt-4 text-muted-foreground">
            {reports.length} run{reports.length > 1 ? "s" : ""}.{" "}
            <Link href={`/reports/${encodeURIComponent(latest.id)}`} className="underline underline-offset-4">Latest report</Link>
          </p>
        </div>
        <div className="space-y-5">
          {latest.summary && (
            <>
              <RatingTag rating={latest.summary.rating} className="text-2xl font-bold tracking-[-0.02em]" />
              <RatingScaleMarker rating={latest.summary.rating} />
            </>
          )}
          <PriceFreshness fetchedAt={index.fetched_at} stale={pricesStale(index)} errors={mapping && index.errors[mapping.symbol] ? { [mapping.symbol]: index.errors[mapping.symbol] } : {}} />
        </div>
      </header>

      {series.length > 0 ? (
        <section className="space-y-10">
          <ChartFrame
            title="Price and verdict levels"
            description={selected ? `Dots mark each run on its trade date. Dashed lines show the target and stop of the run from ${formatDay(selected.report.runAt)}; select another run in the table below.` : "Daily close."}
            table={
              <table className={tableClasses.table}>
                <thead><tr><th className={tableClasses.th}>Date</th><th className={`${tableClasses.th} text-right`}>Close</th><th className={tableClasses.th}>Runs</th></tr></thead>
                <tbody>
                  {series.filter((p) => p.runs.length).map((p) => (
                    <tr key={p.date}><td className={tableClasses.td}>{p.date}</td><td className={`${tableClasses.td} text-right`}>{formatPrice(p.close)}</td><td className={tableClasses.td}>{p.runs.map((r) => r.rating).join(", ")}</td></tr>
                  ))}
                </tbody>
              </table>
            }
          >
            <PriceChart series={series} selectedId={selected?.report.id ?? null} target={selected?.report.summary.price_target ?? null} stop={selected?.report.summary.stop_loss ?? null} />
          </ChartFrame>
          <ChartFrame
            title="Rating history"
            description="The committee’s rating on each date, carried forward until the next run."
            table={
              <table className={tableClasses.table}>
                <thead><tr><th className={tableClasses.th}>Trade date</th><th className={tableClasses.th}>Rating</th></tr></thead>
                <tbody>{cards.map((c) => <tr key={c.report.id}><td className={tableClasses.td}>{c.tradeDate.date}</td><td className={tableClasses.td}>{c.report.summary.rating}</td></tr>)}</tbody>
              </table>
            }
          >
            <RatingHistoryChart series={series} />
          </ChartFrame>
        </section>
      ) : (
        <p className="text-muted-foreground">{priceError ?? "No price data yet."} Refresh prices to draw the charts.</p>
      )}

      <section className="space-y-4">
        <h2 className="text-xl font-bold tracking-[-0.02em]">Runs</h2>
        {cards.length ? <RunsTable cards={cards} selectedId={selected?.report.id ?? null} /> : <p className="text-muted-foreground">No summarized runs yet. Summarize a report to score it.</p>}
      </section>
    </div>
  );
}
