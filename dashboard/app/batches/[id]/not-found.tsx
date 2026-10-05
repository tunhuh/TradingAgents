import Link from "next/link";

export default function NotFound() {
  return (
    <div className="space-y-2">
      <h1 className="text-xl font-semibold">Batch not found</h1>
      <Link href="/batches" className="underline">Back to batches</Link>
    </div>
  );
}
