"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { todayLocal } from "@/lib/format";
import { ANALYSTS, ANALYST_LABELS, type Analyst } from "@/lib/types";

export function NewBatchForm() {
  const router = useRouter();
  const [tickers, setTickers] = useState("");
  const [tradeDate, setTradeDate] = useState(todayLocal());
  const [analysts, setAnalysts] = useState<Analyst[]>([...ANALYSTS]);
  const [debate, setDebate] = useState(1);
  const [risk, setRisk] = useState(1);
  const [autoSummarize, setAutoSummarize] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<{ message: string; activeBatchId?: string } | null>(null);

  const toggle = (a: Analyst, on: boolean) =>
    setAnalysts((cur) => (on ? [...new Set([...cur, a])] : cur.filter((x) => x !== a)));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    const res = await fetch("/api/batches", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        tickers, trade_date: tradeDate, analysts,
        max_debate_rounds: debate, max_risk_discuss_rounds: risk, auto_summarize: autoSummarize,
      }),
    });
    const data = await res.json().catch(() => ({}));
    setPending(false);
    if (res.ok) router.push(`/batches/${data.id}`);
    else setError({ message: data.error ?? `Failed (${res.status})`, activeBatchId: data.activeBatchId });
  }

  return (
    <form onSubmit={submit} className="max-w-xl space-y-5">
      <div className="space-y-2">
        <Label htmlFor="tickers">Tickers</Label>
        <Textarea id="tickers" placeholder="NVDA, MSFT, BTC-USD" value={tickers} onChange={(e) => setTickers(e.target.value)} required />
        <p className="text-xs text-muted-foreground">Comma, space or newline separated. Up to 20. Runs one after another.</p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="date">Trade date</Label>
        <Input id="date" type="date" max={todayLocal()} value={tradeDate} onChange={(e) => setTradeDate(e.target.value)} className="w-48" required />
      </div>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Analysts</legend>
        <div className="flex flex-wrap gap-4">
          {ANALYSTS.map((a) => (
            <label key={a} className="flex items-center gap-2 text-sm">
              <Checkbox checked={analysts.includes(a)} onCheckedChange={(v) => toggle(a, v === true)} />
              {ANALYST_LABELS[a]}
            </label>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">Crypto tickers skip the Fundamentals analyst.</p>
      </fieldset>
      <div className="flex gap-6">
        <div className="space-y-2">
          <Label htmlFor="debate">Debate rounds</Label>
          <Input id="debate" type="number" min={1} max={5} value={debate} onChange={(e) => setDebate(Number(e.target.value))} className="w-24" />
        </div>
        <div className="space-y-2">
          <Label htmlFor="risk">Risk rounds</Label>
          <Input id="risk" type="number" min={1} max={5} value={risk} onChange={(e) => setRisk(Number(e.target.value))} className="w-24" />
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <Checkbox checked={autoSummarize} onCheckedChange={(v) => setAutoSummarize(v === true)} />
        Summarize each report when it finishes
      </label>
      {error && (
        <p className="text-sm text-red-600">
          {error.message}
          {error.activeBatchId && (
            <> — <Link className="underline" href={`/batches/${error.activeBatchId}`}>view the running batch</Link></>
          )}
        </p>
      )}
      <Button type="submit" disabled={pending || analysts.length === 0}>
        {pending ? "Starting…" : "Start batch"}
      </Button>
    </form>
  );
}
