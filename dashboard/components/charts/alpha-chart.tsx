"use client";

import { Bar, BarChart, CartesianGrid, Cell, LabelList, ReferenceLine, Rectangle, ResponsiveContainer, XAxis, YAxis } from "recharts";
import { barValueLabel } from "@/components/charts/bar-value-label";
import { ChartFrame, tableClasses } from "@/components/charts/chart-frame";
import { axisTick, useChartTokens } from "@/components/charts/use-chart-tokens";
import { formatPercent } from "@/lib/format";
import type { ScoreSummary } from "@/lib/scorecard";

export function AlphaChart({ rows }: { rows: ScoreSummary["byRating"] }) {
  const t = useChartTokens();
  const data = rows.filter((r) => r.avgAlpha20 != null).map((r) => ({ rating: r.rating, alpha: r.avgAlpha20 as number, n: r.alphaN }));
  // Symmetric axis rounded up to an even whole percent, with room for labels past the bar ends.
  const max = Math.ceil((Math.max(0.01, ...data.map((d) => Math.abs(d.alpha))) * 125) / 2) * 0.02;
  const ticks = [-max, -max / 2, 0, max / 2, max];
  const tickLabel = (v: number) => (Math.abs(v) < 1e-9 ? "0%" : formatPercent(v, { signed: true, digits: 0 }));

  return (
    <ChartFrame
      title="Return against the benchmark after 20 trading days"
      description="Average by rating. Buys should sit right of zero and sells left of it."
      table={
        <table className={tableClasses.table}>
          <thead><tr><th className={tableClasses.th}>Rating</th><th className={`${tableClasses.th} text-right`}>Average</th><th className={`${tableClasses.th} text-right`}>Verdicts</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.rating}><td className={tableClasses.td}>{r.rating}</td><td className={`${tableClasses.td} text-right`}>{formatPercent(r.avgAlpha20, { signed: true })}</td><td className={`${tableClasses.td} text-right`}>{r.alphaN}</td></tr>)}</tbody>
        </table>
      }
    >
      {!t ? (
        <div className="h-56" aria-hidden />
      ) : data.length === 0 ? (
        <p className="py-10 text-muted-foreground">No verdict has 20 trading days of prices yet.</p>
      ) : (
        <div style={{ height: 48 * data.length + 32 }} role="img" aria-label="Average 20-day return against the benchmark by rating">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} layout="vertical" margin={{ top: 0, right: 24, bottom: 0, left: 0 }} barCategoryGap={8}>
              <CartesianGrid horizontal={false} stroke={t.border} />
              <XAxis type="number" domain={[-max, max]} ticks={ticks} tickFormatter={tickLabel} tick={axisTick(t)} tickLine={false} axisLine={false} />
              <YAxis type="category" dataKey="rating" tick={{ ...axisTick(t), fill: t.ink }} tickLine={false} axisLine={false} width={96} />
              <ReferenceLine x={0} stroke={t.muted} />
              <Bar
                dataKey="alpha"
                isAnimationActive={false}
                // Round only the data end; the end on the zero line stays square.
                shape={(props: unknown) => {
                  const p = props as Record<string, unknown> & { alpha?: number };
                  return <Rectangle {...p} radius={(p.alpha ?? 0) < 0 ? [4, 0, 0, 4] : [0, 4, 4, 0]} />;
                }}
              >
                {data.map((d) => <Cell key={d.rating} fill={t.rating[d.rating]} />)}
                <LabelList dataKey="alpha" content={barValueLabel((v) => (Math.abs(v) < 0.0005 ? "0.0%" : formatPercent(v, { signed: true })), t.ink)} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </ChartFrame>
  );
}
