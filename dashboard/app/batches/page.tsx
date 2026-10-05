import Link from "next/link";
import { StatusMark } from "@/components/status-mark";
import { Button } from "@/components/ui/button";
import { isOrphaned, listBatches } from "@/lib/batches";
import { formatIsoWhen } from "@/lib/format";

export const dynamic = "force-dynamic";

const th = "py-2 pr-4 text-left text-sm font-normal text-muted-foreground";
const td = "border-t border-border py-3 pr-4 align-top";

export default async function BatchesPage() {
  const batches = await listBatches();
  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-3xl font-bold tracking-[-0.03em]">Batches</h1>
        <Button asChild><Link href="/batches/new">New batch</Link></Button>
      </div>
      {batches.length === 0 ? (
        <p className="max-w-xl text-muted-foreground">
          No batches yet. A batch runs the committee on several tickers, one after another, and summarizes each report.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] border-collapse text-[0.9375rem]">
            <thead>
              <tr>
                <th className={th}>Tickers</th>
                <th className={th}>Started</th>
                <th className={th}>Trade date</th>
                <th className={th}>Status</th>
                <th className={`${th} text-right`}>Done</th>
                <th className={`${th} text-right`}>Failed</th>
              </tr>
            </thead>
            <tbody>
              {batches.map((b) => (
                <tr key={b.id}>
                  <td className={td}>
                    <Link href={`/batches/${b.id}`} className="text-lg leading-tight font-bold tracking-[-0.02em] underline-offset-4 hover:underline">
                      {b.params.tickers.join(" ")}
                    </Link>
                  </td>
                  <td className={`${td} whitespace-nowrap text-muted-foreground`}>{formatIsoWhen(b.created_at)}</td>
                  <td className={`${td}`}>{b.params.trade_date}</td>
                  <td className={td}><StatusMark status={isOrphaned(b) ? "failed" : b.status} /></td>
                  <td className={`${td} text-right`}>{b.items.filter((i) => i.status === "done").length}</td>
                  <td className={`${td} text-right`}>{b.items.filter((i) => i.status === "failed").length}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
