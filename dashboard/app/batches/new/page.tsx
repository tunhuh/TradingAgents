import { NewBatchForm } from "@/components/new-batch-form";

// Per request, so the form's default trade date is today rather than the build date.
export const dynamic = "force-dynamic";

export default function NewBatchPage() {
  return (
    <div className="space-y-8">
      <div className="max-w-2xl space-y-2">
        <h1 className="text-3xl font-bold tracking-[-0.03em]">New batch</h1>
        <p className="text-muted-foreground">Run the full committee on each ticker for one trade date. Only one batch runs at a time.</p>
      </div>
      <NewBatchForm />
    </div>
  );
}
