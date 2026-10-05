import { notFound } from "next/navigation";
import { Markdown } from "@/components/markdown";
import { SummarizeButton } from "@/components/summarize-button";
import { SummaryCard } from "@/components/summary-card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatRunAt } from "@/lib/format";
import { NotFoundError, decodeRouteParam } from "@/lib/paths";
import { getReport } from "@/lib/reports";
import type { ReportDetail } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let report: ReportDetail;
  try {
    report = await getReport(decodeRouteParam(id));
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    throw e;
  }
  const tabs = [
    ...report.steps.map((s) => ({ key: s.key, title: s.title, body: s.sections.map((x) => `## ${x.title}\n\n${x.markdown}`).join("\n\n") })),
    ...(report.complete ? [{ key: "full", title: "Full report", body: report.complete }] : []),
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-2xl font-semibold">
          {report.ticker} <span className="text-base font-normal text-muted-foreground">{formatRunAt(report.runAt)}</span>
        </h1>
        {report.complete && (
          <SummarizeButton reportId={report.id} label={report.summary ? "Regenerate summary" : "Summarize"} />
        )}
      </div>
      {report.summary && <SummaryCard summary={report.summary} stale={report.summaryStale} />}
      {tabs.length > 0 ? (
        <Tabs defaultValue={tabs[0].key}>
          <TabsList className="flex-wrap">
            {tabs.map((t) => <TabsTrigger key={t.key} value={t.key}>{t.title}</TabsTrigger>)}
          </TabsList>
          {tabs.map((t) => (
            <TabsContent key={t.key} value={t.key} className="pt-4"><Markdown>{t.body}</Markdown></TabsContent>
          ))}
        </Tabs>
      ) : (
        <p className="text-muted-foreground">This report folder has no report files.</p>
      )}
    </div>
  );
}
