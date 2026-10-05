import Link from "next/link";

export default function NotFound() {
  return (
    <div className="space-y-2">
      <h1 className="text-xl font-semibold">Report not found</h1>
      <Link href="/" className="underline">Back to reports</Link>
    </div>
  );
}
