"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { RatingTag } from "@/components/rating-tag";
import { SummarizeButton } from "@/components/summarize-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatPrice, formatWhen } from "@/lib/format";
import type { ReportListItem } from "@/lib/types";

const th = "py-2 pr-4 text-left text-sm font-normal text-muted-foreground";
const td = "border-t border-border py-3 pr-4 align-top";

export function ReportsTable({ reports }: { reports: ReportListItem[] }) {
  const [ticker, setTicker] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const rows = useMemo(() => {
    const q = ticker.trim().toUpperCase();
    return reports.filter((r) => {
      const day = r.runAt.slice(0, 10);
      return (!q || r.ticker.toUpperCase().includes(q)) && (!from || day >= from) && (!to || day <= to);
    });
  }, [reports, ticker, from, to]);

  return (
    <div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="f-ticker" className="text-xs text-muted-foreground">Ticker</Label>
          <Input id="f-ticker" value={ticker} onChange={(e) => setTicker(e.target.value)} className="w-32 bg-card" />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="f-from" className="text-xs text-muted-foreground">From</Label>
          <Input id="f-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40 bg-card" />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="f-to" className="text-xs text-muted-foreground">To</Label>
          <Input id="f-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40 bg-card" />
        </div>
      </div>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[44rem] border-collapse text-[0.9375rem]">
          <thead>
            <tr>
              <th className={th}>Ticker</th>
              <th className={th}>Run</th>
              <th className={th}>Rating</th>
              <th className={`${th} text-right`}>Target</th>
              <th className={th}>Horizon</th>
              <th className={th}>Summary</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className={td}>
                  <Link href={`/reports/${encodeURIComponent(r.id)}`} className="text-lg leading-none font-bold tracking-[-0.02em] underline-offset-4 hover:underline">
                    {r.ticker}
                  </Link>
                </td>
                <td className={`${td} whitespace-nowrap text-muted-foreground`}>{formatWhen(r.runAt)}</td>
                <td className={td}><RatingTag rating={r.summary?.rating} /></td>
                <td className={`${td} text-right`}>{formatPrice(r.summary?.price_target)}</td>
                <td className={`${td} whitespace-nowrap`}>{r.summary?.time_horizon ?? "—"}</td>
                <td className={`${td} max-w-[28rem]`}>
                  {r.summary ? (
                    <span className="line-clamp-2 text-muted-foreground">{r.summary.tldr}</span>
                  ) : r.hasReport ? (
                    <SummarizeButton reportId={r.id} />
                  ) : (
                    <span className="text-muted-foreground">No report file to summarize</span>
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className={`${td} py-10 text-muted-foreground`}>No runs match these filters.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
