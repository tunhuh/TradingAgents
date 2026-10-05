"use client";

import { useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, XAxis, YAxis } from "recharts";
import { barValueLabel } from "@/components/charts/bar-value-label";
import { ChartFrame, tableClasses } from "@/components/charts/chart-frame";
import { axisTick, useChartTokens } from "@/components/charts/use-chart-tokens";
import { formatRate } from "@/lib/format";
import type { ScoreSummary } from "@/lib/scorecard";
import { cn } from "@/lib/utils";

const MEASURES = [
  { key: "levels", label: "Target vs stop" },
  { key: "benchmark", label: "Beat the benchmark" },
  { key: "absolute", label: "Absolute return" },
] as const;
type MeasureKey = (typeof MEASURES)[number]["key"];

export function HitRateChart({ rows }: { rows: ScoreSummary["byRating"] }) {
  const t = useChartTokens();
  const [measure, setMeasure] = useState<MeasureKey>("levels");
  const data = rows
    .map((r) => ({ rating: r.rating, rate: r[measure].rate, settled: r[measure].right + r[measure].wrong }))
    .filter((r) => r.rate != null);

  return (
    <ChartFrame
      title="Hit rate by rating"
      description="Share of settled verdicts that were right."
      table={
        <table className={tableClasses.table}>
          <thead><tr><th className={tableClasses.th}>Rating</th>{MEASURES.map((m) => <th key={m.key} className={`${tableClasses.th} text-right`}>{m.label}</th>)}</tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.rating}>
                <td className={tableClasses.td}>{r.rating}</td>
                {MEASURES.map((m) => <td key={m.key} className={`${tableClasses.td} text-right`}>{formatRate(r[m.key].rate)} ({r[m.key].right} of {r[m.key].right + r[m.key].wrong})</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      }
    >
      <div role="group" aria-label="Measure" className="flex flex-wrap gap-1">
        {MEASURES.map((m) => (
          <button
            key={m.key}
            type="button"
            aria-pressed={measure === m.key}
            onClick={() => setMeasure(m.key)}
            className={cn("rounded-[3px] px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground", measure === m.key && "bg-card font-semibold text-foreground")}
          >
            {m.label}
          </button>
        ))}
      </div>
      {!t ? (
        <div className="h-56" aria-hidden />
      ) : data.length === 0 ? (
        <p className="py-10 text-muted-foreground">No settled verdicts for this measure yet.</p>
      ) : (
        <div style={{ height: 48 * data.length + 32 }} role="img" aria-label={`Hit rate by rating, ${MEASURES.find((m) => m.key === measure)!.label}`}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} layout="vertical" margin={{ top: 0, right: 96, bottom: 0, left: 0 }} barCategoryGap={8}>
              <CartesianGrid horizontal={false} stroke={t.border} />
              <XAxis type="number" domain={[0, 1]} tickFormatter={(v: number) => formatRate(v)} tick={axisTick(t)} tickLine={false} axisLine={false} />
              <YAxis type="category" dataKey="rating" tick={{ ...axisTick(t), fill: t.ink }} tickLine={false} axisLine={false} width={96} />
              <Bar dataKey="rate" radius={[0, 4, 4, 0]} minPointSize={2} isAnimationActive={false}>
                {data.map((d) => <Cell key={d.rating} fill={t.rating[d.rating]} />)}
                <LabelList dataKey="rate" content={barValueLabel((v) => formatRate(v), t.ink)} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </ChartFrame>
  );
}
