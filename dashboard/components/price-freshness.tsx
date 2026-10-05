"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { formatIsoWhen } from "@/lib/format";

/** Shows when prices were fetched; refreshes once automatically when the cache is stale. */
export function PriceFreshness({ fetchedAt, stale, errors }: { fetchedAt: string | null; stale: boolean; errors: Record<string, string> }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const autoStarted = useRef(false);

  async function refresh() {
    setBusy(true);
    setMessage(null);
    const res = await fetch("/api/prices/refresh", { method: "POST" }).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : {};
    setBusy(false);
    if (res?.ok) router.refresh();
    else setMessage(res?.status === 409 ? "Already refreshing." : (data.error ?? "Couldn’t reach the dashboard server."));
  }

  useEffect(() => {
    if (stale && !autoStarted.current) {
      autoStarted.current = true;
      void refresh();
    }
    // Runs once per mount; refresh() is stable enough for this purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stale]);

  const failed = Object.keys(errors);
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
      <span aria-live="polite">
        {busy ? "Updating prices…" : fetchedAt ? `Prices updated ${formatIsoWhen(fetchedAt)}` : "No prices fetched yet"}
      </span>
      <Button size="sm" variant="outline" onClick={refresh} disabled={busy}>Refresh prices</Button>
      {message && <span className="text-destructive">{message}</span>}
      {failed.length > 0 && !message && <span>No prices for {failed.join(", ")}.</span>}
    </div>
  );
}
