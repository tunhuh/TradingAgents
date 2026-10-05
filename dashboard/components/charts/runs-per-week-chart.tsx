"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartFrame, tableClasses } from "@/components/charts/chart-frame";
import { ChartTooltipBox } from "@/components/charts/chart-tooltip";
import { axisTick, useChartTokens } from "@/components/charts/use-chart-tokens";
import { formatDay } from "@/lib/format";

const week = (d: string) => formatDay(`${d}T00:00`);

export function RunsPerWeekChart({ weeks }: { weeks: { week: string; count: number }[] }) {
  const t = useChartTokens();
  return (
    <ChartFrame
      title="Runs per week"
      description="Reports run in each of the last 26 weeks, by the Monday each week starts."
      table={
        <table className={tableClasses.table}>
          <thead><tr><th className={tableClasses.th}>Week of</th><th className={`${tableClasses.th} text-right`}>Runs</th></tr></thead>
          <tbody>{weeks.filter((w) => w.count).map((w) => <tr key={w.week}><td className={tableClasses.td}>{week(w.week)}</td><td className={`${tableClasses.td} text-right`}>{w.count}</td></tr>)}</tbody>
        </table>
      }
    >
      {!t ? (
        <div className="h-48" aria-hidden />
      ) : (
        <div className="h-48" role="img" aria-label="Runs per week over the last 26 weeks">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={weeks} margin={{ top: 8, right: 0, bottom: 0, left: 0 }} barCategoryGap={2}>
              <CartesianGrid vertical={false} stroke={t.border} />
              <XAxis dataKey="week" tickFormatter={week} minTickGap={40} tick={axisTick(t)} tickLine={false} axisLine={{ stroke: t.border }} />
              <YAxis allowDecimals={false} tick={axisTick(t)} tickLine={false} axisLine={false} width={32} />
              <Tooltip
                cursor={{ fill: t.border, opacity: 0.4 }}
                content={({ active, payload }) => {
                  const w = active ? (payload?.[0]?.payload as { week: string; count: number } | undefined) : undefined;
                  return w ? <ChartTooltipBox>Week of {week(w.week)}: {w.count} run{w.count === 1 ? "" : "s"}</ChartTooltipBox> : null;
                }}
              />
              <Bar dataKey="count" fill={t.ink} radius={[4, 4, 0, 0]} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </ChartFrame>
  );
}
