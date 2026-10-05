"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { RatingBadge } from "@/components/rating-badge";
import { SummarizeButton } from "@/components/summarize-button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatPrice, formatRunAt } from "@/lib/format";
import type { ReportListItem } from "@/lib/types";

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
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3">
        <Input placeholder="Filter ticker" value={ticker} onChange={(e) => setTicker(e.target.value)} className="w-40" />
        <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-44" aria-label="From date" />
        <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-44" aria-label="To date" />
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Ticker</TableHead>
            <TableHead>Run time</TableHead>
            <TableHead>Rating</TableHead>
            <TableHead className="text-right">Target</TableHead>
            <TableHead>Horizon</TableHead>
            <TableHead>TL;DR</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.id}>
              <TableCell className="font-medium">
                <Link href={`/reports/${encodeURIComponent(r.id)}`} className="underline-offset-4 hover:underline">{r.ticker}</Link>
              </TableCell>
              <TableCell className="whitespace-nowrap">{formatRunAt(r.runAt)}</TableCell>
              <TableCell><RatingBadge rating={r.summary?.rating} /></TableCell>
              <TableCell className="text-right">{formatPrice(r.summary?.price_target)}</TableCell>
              <TableCell>{r.summary?.time_horizon ?? "—"}</TableCell>
              <TableCell className="max-w-md whitespace-normal">
                {r.summary ? <span className="line-clamp-2 text-sm">{r.summary.tldr}</span> : <SummarizeButton reportId={r.id} />}
              </TableCell>
            </TableRow>
          ))}
          {rows.length === 0 && (
            <TableRow>
              <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">No reports match.</TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
