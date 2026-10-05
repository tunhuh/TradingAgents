"use client";

import { useRouter } from "next/navigation";
import { CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartTooltipBox } from "@/components/charts/chart-tooltip";
import { axisTick, useChartTokens } from "@/components/charts/use-chart-tokens";
import { formatDay, formatPrice, formatWhen } from "@/lib/format";
import type { PricePoint } from "@/lib/ticker-series";

const tickDay = (date: string) => formatDay(`${date}T00:00`);

interface DotArgs {
  cx?: number;
  cy?: number;
  index?: number;
  payload?: PricePoint;
}

export function PriceChart({ series, selectedId, target, stop }: { series: PricePoint[]; selectedId: string | null; target: number | null; stop: number | null }) {
  const t = useChartTokens();
  const router = useRouter();
  if (!t) return <div className="h-80" aria-hidden />;

  const renderDot = ({ cx, cy, index, payload }: DotArgs) => {
    if (cx == null || cy == null || !payload?.runs.length) return <g key={`d${index}`} />;
    const run = payload.runs[payload.runs.length - 1];
    const selected = payload.runs.some((r) => r.reportId === selectedId);
    return (
      <circle
        key={`d${index}`}
        cx={cx}
        cy={cy}
        r={selected ? 7 : 5}
        fill={t.rating[run.rating] ?? t.ink}
        stroke={selected ? t.ink : t.surface}
        strokeWidth={2}
        className="cursor-pointer"
        onClick={() => router.replace(`?run=${encodeURIComponent(run.reportId)}`, { scroll: false })}
      />
    );
  };

  return (
    <div className="h-80" role="img" aria-label="Daily closing price with each run marked on its trade date">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={series} margin={{ top: 12, right: 88, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke={t.border} />
          <XAxis dataKey="date" tickFormatter={tickDay} minTickGap={56} tick={axisTick(t)} tickLine={false} axisLine={{ stroke: t.border }} />
          <YAxis domain={["auto", "auto"]} tickFormatter={(v: number) => formatPrice(v)} tick={axisTick(t)} tickLine={false} axisLine={false} width={92} />
          <Tooltip
            cursor={{ stroke: t.muted, strokeWidth: 1 }}
            content={({ active, payload }) => {
              const p = active ? (payload?.[0]?.payload as PricePoint | undefined) : undefined;
              if (!p) return null;
              return (
                <ChartTooltipBox>
                  <div className="font-semibold">{tickDay(p.date)}</div>
                  <div>Close {formatPrice(p.close)}</div>
                  {p.runs.map((r) => <div key={r.reportId}>{r.rating}, run {formatWhen(r.runAt)}</div>)}
                </ChartTooltipBox>
              );
            }}
          />
          {target != null && (
            <ReferenceLine y={target} ifOverflow="extendDomain" stroke={t.ink} strokeDasharray="4 4" label={{ value: `Target ${formatPrice(target)}`, position: "right", fill: t.muted, fontSize: 12 }} />
          )}
          {stop != null && (
            <ReferenceLine y={stop} ifOverflow="extendDomain" stroke={t.ink} strokeDasharray="2 4" label={{ value: `Stop ${formatPrice(stop)}`, position: "right", fill: t.muted, fontSize: 12 }} />
          )}
          <Line
            dataKey="close"
            stroke={t.ink}
            strokeWidth={2}
            isAnimationActive={false}
            activeDot={{ r: 4, fill: t.ink, stroke: t.surface, strokeWidth: 2 }}
            dot={(props: unknown) => renderDot(props as DotArgs)}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
