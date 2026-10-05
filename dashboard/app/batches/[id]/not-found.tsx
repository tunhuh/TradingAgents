import Link from "next/link";

export default function NotFound() {
  return (
    <div className="space-y-4">
      <h1 className="text-3xl font-bold tracking-[-0.03em]">Batch not found</h1>
      <Link href="/batches" className="underline underline-offset-4">Back to batches</Link>
    </div>
  );
}
