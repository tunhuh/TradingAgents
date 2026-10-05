import Link from "next/link";
import { notFound } from "next/navigation";
import { AutoRefresh } from "@/components/auto-refresh";
import { BatchStatusBadge } from "@/components/batch-status-badge";
import { CancelBatchButton } from "@/components/cancel-batch-button";
import { ComparisonTable } from "@/components/comparison-table";
import { RatingBadge } from "@/components/rating-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getBatch, isActive, isOrphaned, readLogTail } from "@/lib/batches";
import type { ComparisonRow } from "@/lib/compare";
import { formatIso } from "@/lib/format";
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
  return (
    <div className="space-y-6">
      <AutoRefresh active={active} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="flex items-center gap-3 text-2xl font-semibold">
          Batch {formatIso(batch.created_at)} <BatchStatusBadge status={orphaned ? "failed" : batch.status} />
        </h1>
        {active && batch.pid != null && <CancelBatchButton batchId={batch.id} />}
        {orphaned && <CancelBatchButton batchId={batch.id} label="Mark as failed" />}
      </div>
      <p className="text-sm text-muted-foreground">
        Trade date {p.trade_date} · Analysts {p.analysts.map((a) => ANALYST_LABELS[a]).join(", ")} · Debate {p.max_debate_rounds} · Risk {p.max_risk_discuss_rounds}
        {p.auto_summarize ? " · Auto-summarize" : ""}
      </p>
      {orphaned && <p className="text-sm text-red-600">The worker process exited unexpectedly. Check the log below.</p>}
      {batch.error && <p className="text-sm text-red-600">{batch.error}</p>}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Ticker</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Signal</TableHead>
            <TableHead>Summary</TableHead>
            <TableHead>Finished</TableHead>
            <TableHead>Report / error</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {batch.items.map((item) => (
            <TableRow key={item.ticker}>
              <TableCell className="font-medium">{item.ticker}</TableCell>
              <TableCell><BatchStatusBadge status={item.status} /></TableCell>
              <TableCell><RatingBadge rating={item.signal} /></TableCell>
              <TableCell className="text-sm">{item.summary_status}</TableCell>
              <TableCell className="whitespace-nowrap text-sm">{formatIso(item.finished_at)}</TableCell>
              <TableCell className="max-w-md whitespace-normal text-sm">
                {item.report_id && (
                  <Link href={`/reports/${encodeURIComponent(item.report_id)}`} className="underline">Open report</Link>
                )}
                {item.error && <div className="text-red-600">{item.error}</div>}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {rows.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-lg font-semibold">Comparison</h2>
          <ComparisonTable rows={rows} />
        </section>
      )}

      {log && (
        <details>
          <summary className="cursor-pointer text-sm text-muted-foreground">Worker log (last 50 lines)</summary>
          <pre className="mt-2 max-h-96 overflow-auto rounded bg-muted p-3 text-xs">{log}</pre>
        </details>
      )}
    </div>
  );
}
