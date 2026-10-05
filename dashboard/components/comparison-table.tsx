import Link from "next/link";
import { RatingBadge } from "@/components/rating-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { sortForComparison, type ComparisonRow } from "@/lib/compare";
import { formatPrice } from "@/lib/format";

export function ComparisonTable({ rows }: { rows: ComparisonRow[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Ticker</TableHead>
          <TableHead>Rating</TableHead>
          <TableHead className="text-right">Price target</TableHead>
          <TableHead className="text-right">Stop</TableHead>
          <TableHead>Horizon</TableHead>
          <TableHead>TL;DR</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {sortForComparison(rows).map((r) => (
          <TableRow key={r.reportId}>
            <TableCell className="font-medium">
              <Link href={`/reports/${encodeURIComponent(r.reportId)}`} className="underline-offset-4 hover:underline">{r.ticker}</Link>
            </TableCell>
            <TableCell><RatingBadge rating={r.summary.rating} /></TableCell>
            <TableCell className="text-right">{formatPrice(r.summary.price_target)}</TableCell>
            <TableCell className="text-right">{formatPrice(r.summary.stop_loss)}</TableCell>
            <TableCell>{r.summary.time_horizon ?? "—"}</TableCell>
            <TableCell className="max-w-md whitespace-normal text-sm">{r.summary.tldr}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
