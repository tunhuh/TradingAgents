import Link from "next/link";
import { RatingTag } from "@/components/rating-tag";
import { sortForComparison, type ComparisonRow } from "@/lib/compare";
import { formatPrice } from "@/lib/format";

const th = "py-2 pr-4 text-left text-sm font-normal text-muted-foreground";
const td = "border-t border-border py-3 pr-4 align-top";

/** Rating, levels and summary for each ticker, Buy → Sell. */
export function TermsTable({ rows }: { rows: ComparisonRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[44rem] border-collapse text-[0.9375rem]">
        <thead>
          <tr>
            <th className={th}>Ticker</th>
            <th className={th}>Rating</th>
            <th className={`${th} text-right`}>Target</th>
            <th className={`${th} text-right`}>Stop</th>
            <th className={th}>Horizon</th>
            <th className={th}>Summary</th>
          </tr>
        </thead>
        <tbody>
          {sortForComparison(rows).map((r) => (
            <tr key={r.reportId}>
              <td className={td}>
                <Link href={`/reports/${encodeURIComponent(r.reportId)}`} className="text-lg leading-none font-bold tracking-[-0.02em] underline-offset-4 hover:underline">
                  {r.ticker}
                </Link>
              </td>
              <td className={td}><RatingTag rating={r.summary.rating} /></td>
              <td className={`${td} text-right`}>{formatPrice(r.summary.price_target)}</td>
              <td className={`${td} text-right`}>{formatPrice(r.summary.stop_loss)}</td>
              <td className={`${td} whitespace-nowrap`}>{r.summary.time_horizon ?? "—"}</td>
              <td className={`${td} max-w-[30rem] text-muted-foreground`}>{r.summary.tldr}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
