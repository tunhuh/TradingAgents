import Link from "next/link";
import { BatchStatusBadge } from "@/components/batch-status-badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { isOrphaned, listBatches } from "@/lib/batches";
import { formatIso } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function BatchesPage() {
  const batches = await listBatches();
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Batches</h1>
        <Button asChild><Link href="/batches/new">New batch</Link></Button>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Created</TableHead>
            <TableHead>Tickers</TableHead>
            <TableHead>Trade date</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Done / failed</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {batches.map((b) => (
            <TableRow key={b.id}>
              <TableCell><Link href={`/batches/${b.id}`} className="underline-offset-4 hover:underline">{formatIso(b.created_at)}</Link></TableCell>
              <TableCell>{b.params.tickers.join(", ")}</TableCell>
              <TableCell>{b.params.trade_date}</TableCell>
              <TableCell><BatchStatusBadge status={isOrphaned(b) ? "failed" : b.status} /></TableCell>
              <TableCell className="text-right">
                {b.items.filter((i) => i.status === "done").length} / {b.items.filter((i) => i.status === "failed").length}
              </TableCell>
            </TableRow>
          ))}
          {batches.length === 0 && (
            <TableRow><TableCell colSpan={5} className="py-8 text-center text-muted-foreground">No batches yet.</TableCell></TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
