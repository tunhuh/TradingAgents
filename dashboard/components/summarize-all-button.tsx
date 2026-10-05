"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";

/** Summarizes reports one at a time (each is an LLM call), refreshing as each lands. */
export function SummarizeAllButton({ reports }: { reports: { id: string; ticker: string }[] }) {
  const router = useRouter();
  const [current, setCurrent] = useState<number | null>(null);
  const [failed, setFailed] = useState<string[]>([]);

  async function run() {
    setFailed([]);
    const failures: string[] = [];
    for (let i = 0; i < reports.length; i++) {
      setCurrent(i);
      const res = await fetch(`/api/reports/${encodeURIComponent(reports[i].id)}/summary`, { method: "POST" }).catch(() => null);
      if (res?.ok) router.refresh();
      else failures.push(reports[i].ticker);
    }
    setCurrent(null);
    setFailed(failures);
  }

  const busy = current !== null;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <Button size="sm" variant="outline" onClick={run} disabled={busy}>
        {busy ? `Summarizing ${reports[current].ticker} (${current + 1} of ${reports.length})` : `Summarize all ${reports.length}`}
      </Button>
      {failed.length > 0 && (
        <span className="text-sm text-destructive">
          Couldn’t summarize {failed.join(", ")}. Open the report to retry and see the error.
        </span>
      )}
    </div>
  );
}
