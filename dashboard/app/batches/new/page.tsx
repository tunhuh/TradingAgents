import { NewBatchForm } from "@/components/new-batch-form";

// Per request, so the form's default trade date is today rather than the build date.
export const dynamic = "force-dynamic";

export default function NewBatchPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">New batch</h1>
      <NewBatchForm />
    </div>
  );
}
