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
import { parseTickerInput } from "@/lib/tickers";
import { ANALYSTS, ANALYST_LABELS, type Analyst } from "@/lib/types";

const MAX_TICKERS = 20;

export function NewBatchForm() {
  const router = useRouter();
  const [tickerText, setTickerText] = useState("");
  const [tradeDate, setTradeDate] = useState(todayLocal());
  const [analysts, setAnalysts] = useState<Analyst[]>([...ANALYSTS]);
  const [debate, setDebate] = useState(1);
  const [risk, setRisk] = useState(1);
  const [autoSummarize, setAutoSummarize] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<{ message: string; activeBatchId?: string } | null>(null);

  const { tickers, invalid } = parseTickerInput(tickerText);
  const tooMany = tickers.length > MAX_TICKERS;
  const canStart = tickers.length > 0 && invalid.length === 0 && !tooMany && analysts.length > 0 && !pending;

  const toggle = (a: Analyst, on: boolean) =>
    setAnalysts((cur) => (on ? ANALYSTS.filter((x) => x === a || cur.includes(x)) : cur.filter((x) => x !== a)));

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
    }).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : { error: "The dashboard server didn’t respond. Check that it’s running." };
    setPending(false);
    if (res?.ok) router.push(`/batches/${data.id}`);
    else setError({ message: data.error ?? `The server answered ${res?.status}.`, activeBatchId: data.activeBatchId });
  }

  return (
    <form onSubmit={submit} className="grid max-w-2xl gap-10">
      <div className="grid gap-3">
        <Label htmlFor="tickers" className="text-base font-semibold">Tickers</Label>
        <Textarea
          id="tickers"
          value={tickerText}
          onChange={(e) => setTickerText(e.target.value)}
          placeholder="nvda, msft, btc-usd"
          aria-describedby="tickers-help"
          className="min-h-24 bg-card text-base"
          required
        />
        <p id="tickers-help" className="text-sm text-muted-foreground">
          Separate with commas, spaces or new lines. Up to {MAX_TICKERS}; they run one after another.
        </p>
        <div aria-live="polite" className="min-h-14">
          {tickers.length > 0 && (
            <ul aria-label="Tickers that will run" className="flex flex-wrap gap-x-5 gap-y-1">
              {tickers.map((t) => (
                <li key={t} className="text-[1.75rem] leading-tight font-extrabold tracking-[-0.045em]">{t}</li>
              ))}
            </ul>
          )}
          {invalid.length > 0 && (
            <p className="mt-1 text-sm text-destructive">Not valid symbols: {invalid.join(", ")}. Remove them to start the batch.</p>
          )}
          {tooMany && <p className="mt-1 text-sm text-destructive">That’s {tickers.length} tickers. Split them into batches of {MAX_TICKERS} or fewer.</p>}
        </div>
      </div>

      <div className="grid gap-3">
        <Label htmlFor="date" className="text-base font-semibold">Trade date</Label>
        <Input id="date" type="date" max={todayLocal()} value={tradeDate} onChange={(e) => setTradeDate(e.target.value)} className="w-48 bg-card" required />
      </div>

      <fieldset className="grid gap-3">
        <legend className="mb-3 text-base font-semibold">Analysts</legend>
        <div className="flex flex-wrap gap-x-6 gap-y-3">
          {ANALYSTS.map((a) => (
            <label key={a} className="flex items-center gap-2">
              <Checkbox checked={analysts.includes(a)} onCheckedChange={(v) => toggle(a, v === true)} />
              {ANALYST_LABELS[a]}
            </label>
          ))}
        </div>
        <p className="text-sm text-muted-foreground">Crypto tickers skip the Fundamentals analyst. Fewer analysts make a run faster and cheaper.</p>
      </fieldset>

      <div className="flex flex-wrap gap-8">
        <div className="grid gap-2">
          <Label htmlFor="debate" className="font-semibold">Debate rounds</Label>
          <Input id="debate" type="number" min={1} max={5} value={debate} onChange={(e) => setDebate(Number(e.target.value))} className="w-24 bg-card" />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="risk" className="font-semibold">Risk rounds</Label>
          <Input id="risk" type="number" min={1} max={5} value={risk} onChange={(e) => setRisk(Number(e.target.value))} className="w-24 bg-card" />
        </div>
      </div>

      <label className="flex items-center gap-2">
        <Checkbox checked={autoSummarize} onCheckedChange={(v) => setAutoSummarize(v === true)} />
        Summarize each report as soon as it finishes
      </label>

      <div className="grid gap-3 border-t border-border pt-6">
        {error && (
          <p className="text-destructive">
            {error.message}
            {error.activeBatchId && (
              <> <Link className="underline underline-offset-4" href={`/batches/${error.activeBatchId}`}>See the running batch</Link>.</>
            )}
          </p>
        )}
        <Button type="submit" size="lg" disabled={!canStart} className="w-fit">
          {pending ? "Starting batch…" : tickers.length > 1 ? `Start batch of ${tickers.length}` : "Start batch"}
        </Button>
      </div>
    </form>
  );
}
