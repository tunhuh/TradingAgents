import Link from "next/link";
import { notFound } from "next/navigation";
import { AutoRefresh } from "@/components/auto-refresh";
import { CancelBatchButton } from "@/components/cancel-batch-button";
import { RatingTag } from "@/components/rating-tag";
import { StatusMark } from "@/components/status-mark";
import { TermsTable } from "@/components/terms-table";
import { VerdictScale } from "@/components/verdict-scale";
import { getBatch, isActive, isOrphaned, readLogTail } from "@/lib/batches";
import type { ComparisonRow } from "@/lib/compare";
import { formatIsoWhen, formatPrice } from "@/lib/format";
import { NotFoundError } from "@/lib/paths";
import { readSummaryForReport } from "@/lib/reports";
import { ANALYST_LABELS, type Batch } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function BatchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let batch: Batch;
  try {
    batch = await getBatch(id);
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const active = isActive(batch);
  const orphaned = isOrphaned(batch);
  const log = await readLogTail(id);

  const rows: ComparisonRow[] = [];
  for (const item of batch.items) {
    if (!item.report_id) continue;
    const summary = await readSummaryForReport(item.report_id);
    if (summary) rows.push({ ticker: item.ticker, reportId: item.report_id, summary });
  }

  const p = batch.params;
  const done = batch.items.filter((i) => i.status === "done").length;
  return (
    <div className="space-y-14">
      <AutoRefresh active={active} />
      <header className="space-y-6 border-b border-border pb-10">
        <h1 className="text-[clamp(2.75rem,7vw,5.25rem)] leading-[0.9] font-extrabold tracking-[-0.05em] break-words">
          {p.tickers.join(" ")}
        </h1>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <StatusMark status={orphaned ? "failed" : batch.status} className="text-lg font-semibold" />
          <span className="text-muted-foreground">
            {done} of {batch.items.length} done, started {formatIsoWhen(batch.created_at)}
          </span>
          {active && batch.pid != null && <CancelBatchButton batchId={batch.id} />}
          {orphaned && <CancelBatchButton batchId={batch.id} label="Mark as failed" />}
        </div>
        {orphaned && <p className="text-destructive">The worker process stopped without finishing. Check the worker log below, then mark the batch as failed.</p>}
        {batch.error && <p className="text-destructive">{batch.error}</p>}
        <dl className="grid max-w-3xl grid-cols-2 gap-x-8 gap-y-3 text-sm sm:grid-cols-5">
          <div><dt className="text-muted-foreground">Trade date</dt><dd className="font-medium">{p.trade_date}</dd></div>
          <div className="col-span-2 sm:col-span-1"><dt className="text-muted-foreground">Analysts</dt><dd className="font-medium">{p.analysts.map((a) => ANALYST_LABELS[a]).join(", ")}</dd></div>
          <div><dt className="text-muted-foreground">Debate rounds</dt><dd className="font-medium">{p.max_debate_rounds}</dd></div>
          <div><dt className="text-muted-foreground">Risk rounds</dt><dd className="font-medium">{p.max_risk_discuss_rounds}</dd></div>
          <div><dt className="text-muted-foreground">Summaries</dt><dd className="font-medium">{p.auto_summarize ? "Automatic" : "Manual"}</dd></div>
        </dl>
      </header>

      <section className="space-y-4">
        <h2 className="text-xl font-bold tracking-[-0.02em]">Progress</h2>
        <ol>
          {batch.items.map((item) => (
            <li key={item.ticker} className="grid gap-x-6 gap-y-1 border-t border-border py-4 sm:grid-cols-[9rem_9rem_1fr] sm:items-baseline">
              <span className="text-2xl leading-none font-extrabold tracking-[-0.04em]">{item.ticker}</span>
              <StatusMark status={item.status} />
              <div className="space-y-1 text-[0.9375rem]">
                {item.signal && (
                  <div className="flex flex-wrap items-baseline gap-x-4">
                    <RatingTag rating={item.signal} />
                    {item.finished_at && <span className="text-muted-foreground">finished {formatIsoWhen(item.finished_at)}</span>}
                    {item.report_id && (
                      <Link href={`/reports/${encodeURIComponent(item.report_id)}`} className="underline underline-offset-4">Open report</Link>
                    )}
                  </div>
                )}
                {item.status === "running" && <span className="text-muted-foreground">The committee is working on this ticker.</span>}
                {item.error && <p className="text-destructive">{item.error}</p>}
              </div>
            </li>
          ))}
        </ol>
      </section>

      {rows.length > 0 && (
        <section className="space-y-8">
          <h2 className="text-xl font-bold tracking-[-0.02em]">Verdicts</h2>
          <VerdictScale
            label="Verdicts in this batch, from Buy to Sell"
            entries={rows.map((r) => ({
              key: r.reportId,
              ticker: r.ticker,
              href: `/reports/${encodeURIComponent(r.reportId)}`,
              rating: r.summary.rating,
              note: r.summary.price_target != null ? `target ${formatPrice(r.summary.price_target)}` : undefined,
            }))}
          />
          <TermsTable rows={rows} />
        </section>
      )}

      {log && (
        <details className="group">
          <summary className="cursor-pointer text-sm text-muted-foreground hover:text-foreground">Worker log, last 50 lines</summary>
          <pre className="mt-3 max-h-96 overflow-auto rounded-[3px] bg-card p-4 text-xs leading-relaxed">{log}</pre>
        </details>
      )}
    </div>
  );
}
