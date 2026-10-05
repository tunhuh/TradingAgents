"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";

export function CancelBatchButton({ batchId, label = "Cancel batch" }: { batchId: string; label?: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  return (
    <Button
      size="sm"
      variant="destructive"
      disabled={pending}
      onClick={async () => {
        setPending(true);
        await fetch(`/api/batches/${batchId}`, { method: "DELETE" });
        setPending(false);
        router.refresh();
      }}
    >
      {pending ? "Cancelling…" : label}
    </Button>
  );
}
