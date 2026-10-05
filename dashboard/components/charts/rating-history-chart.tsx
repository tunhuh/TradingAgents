"use client";

import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartTooltipBox } from "@/components/charts/chart-tooltip";
import { axisTick, useChartTokens } from "@/components/charts/use-chart-tokens";
import { formatDay } from "@/lib/format";
import type { PricePoint } from "@/lib/ticker-series";
import { RATINGS } from "@/lib/types";

const label = (step: number) => RATINGS[RATINGS.length - 1 - step] ?? "";

interface DotArgs {
  cx?: number;
  cy?: number;
  index?: number;
  payload?: PricePoint;
}

/** The committee's rating over time on the same dates as the price chart (its own chart, not a second axis). */
export function RatingHistoryChart({ series }: { series: PricePoint[] }) {
  const t = useChartTokens();
  if (!t) return <div className="h-44" aria-hidden />;

  const renderDot = ({ cx, cy, index, payload }: DotArgs) => {
    if (cx == null || cy == null || !payload?.runs.length) return <g key={`r${index}`} />;
    const rating = payload.runs[payload.runs.length - 1].rating;
    return <circle key={`r${index}`} cx={cx} cy={cy} r={5} fill={t.rating[rating] ?? t.ink} stroke={t.surface} strokeWidth={2} />;
  };

  return (
    <div className="h-44" role="img" aria-label="Rating at each date, from Buy at the top to Sell at the bottom">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={series} margin={{ top: 8, right: 88, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke={t.border} />
          <XAxis dataKey="date" tickFormatter={(d: string) => formatDay(`${d}T00:00`)} minTickGap={56} tick={axisTick(t)} tickLine={false} axisLine={{ stroke: t.border }} />
          <YAxis domain={[0, 4]} ticks={[0, 1, 2, 3, 4]} tickFormatter={label} tick={axisTick(t)} tickLine={false} axisLine={false} width={92} />
          <Tooltip
            cursor={{ stroke: t.muted, strokeWidth: 1 }}
            content={({ active, payload }) => {
              const p = active ? (payload?.[0]?.payload as PricePoint | undefined) : undefined;
              if (!p || p.ratingStep == null) return null;
              return <ChartTooltipBox>{formatDay(`${p.date}T00:00`)}: {label(p.ratingStep)}</ChartTooltipBox>;
            }}
          />
          <Line
            type="stepAfter"
            dataKey="ratingStep"
            stroke={t.muted}
            strokeWidth={2}
            connectNulls={false}
            isAnimationActive={false}
            dot={(props: unknown) => renderDot(props as DotArgs)}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
