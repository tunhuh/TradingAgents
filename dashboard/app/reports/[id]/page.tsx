import Link from "next/link";
import { notFound } from "next/navigation";
import { Markdown } from "@/components/markdown";
import { PriceFreshness } from "@/components/price-freshness";
import { RatingScaleMarker } from "@/components/rating-scale-marker";
import { RatingTag } from "@/components/rating-tag";
import { StepTabs, type Step } from "@/components/step-tabs";
import { SummarizeButton } from "@/components/summarize-button";
import { SummarySection } from "@/components/summary-section";
import { formatPrice, formatWhen } from "@/lib/format";
import { benchmarkSentence, levelsSentence } from "@/lib/outcome-text";
import { NotFoundError, decodeRouteParam } from "@/lib/paths";
import { pricesStale, readPriceIndex } from "@/lib/prices";
import { getReport } from "@/lib/reports";
import { loadScorecard } from "@/lib/scorecard";
import type { ReportDetail, StepKey } from "@/lib/types";

export const dynamic = "force-dynamic";

// Position in the agent pipeline, matching the 1_analysts … 5_portfolio folders.
const STEP_NUMBER: Record<StepKey, number> = { analysts: 1, research: 2, trading: 3, risk: 4, portfolio: 5 };

export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let report: ReportDetail;
  try {
    report = await getReport(decodeRouteParam(id));
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const { summary } = report;
  const [card, priceIndex] = await Promise.all([loadScorecard(report.id), readPriceIndex()]);

  const steps: Step[] = [
    ...report.steps.map((s) => ({
      key: s.key,
      title: s.title,
      number: STEP_NUMBER[s.key],
      content: <Markdown>{s.sections.map((x) => `## ${x.title}\n\n${x.markdown}`).join("\n\n")}</Markdown>,
    })),
    ...(report.complete ? [{ key: "full", title: "Full report", content: <Markdown>{report.complete}</Markdown> }] : []),
  ];

  return (
    <div className="space-y-12">
      <header className="grid gap-8 border-b border-border pb-10 lg:grid-cols-[1fr_22rem] lg:items-start">
        <div>
          <h1 className="text-[clamp(4.5rem,13vw,9rem)] leading-[0.82] font-extrabold tracking-[-0.055em] break-words">{report.ticker}</h1>
          <p className="mt-4 text-muted-foreground">Run {formatWhen(report.runAt)}</p>
        </div>
        <div className="space-y-5">
          {summary ? (
            <>
              <RatingTag rating={summary.rating} className="text-2xl font-bold tracking-[-0.02em]" />
              <RatingScaleMarker rating={summary.rating} />
              <dl className="grid grid-cols-3 gap-4 border-t border-border pt-4">
                <div>
                  <dt className="text-xs text-muted-foreground">Target</dt>
                  <dd className="text-lg font-semibold">{formatPrice(summary.price_target)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Stop</dt>
                  <dd className="text-lg font-semibold">{formatPrice(summary.stop_loss)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Horizon</dt>
                  <dd className="text-lg leading-tight font-semibold">{summary.time_horizon ?? "—"}</dd>
                </div>
              </dl>
              {card && (
                <div className="space-y-1 border-t border-border pt-4 text-[0.9375rem]">
                  <p className="font-semibold">{levelsSentence(card.outcome.levels)}</p>
                  <p className="text-muted-foreground">{benchmarkSentence(card.outcome, card.benchmark)}</p>
                </div>
              )}
            </>
          ) : (
            <p className="text-muted-foreground">No summary yet. Summarize the report to see its rating, target and stop here.</p>
          )}
          {report.complete && (
            <SummarizeButton reportId={report.id} label={summary ? "Regenerate summary" : "Summarize report"} />
          )}
          <div className="space-y-3">
            <Link href={`/tickers/${encodeURIComponent(report.ticker)}`} className="underline underline-offset-4">Price and history</Link>
            {summary && <PriceFreshness fetchedAt={priceIndex.fetched_at} stale={pricesStale(priceIndex)} errors={{}} />}
          </div>
        </div>
      </header>

      {steps.length > 0 ? (
        <StepTabs steps={steps} lead={summary && <SummarySection summary={summary} stale={report.summaryStale} />} />
      ) : (
        <p className="text-muted-foreground">This folder has no report files.</p>
      )}
    </div>
  );
}
