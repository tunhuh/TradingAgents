"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";

export function SummarizeButton({ reportId, label = "Summarize" }: { reportId: string; label?: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/reports/${encodeURIComponent(reportId)}/summary`, { method: "POST" });
      if (!res.ok) setError((await res.json().catch(() => ({}))).error ?? `Failed (${res.status})`);
      else router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setPending(false);
    }
  }

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <Button size="sm" variant="outline" onClick={run} disabled={pending}>
        {pending ? "Summarizing…" : label}
      </Button>
      {error && <span className="max-w-xs text-xs text-red-600">{error}</span>}
    </span>
  );
}
