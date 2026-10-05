import Link from "next/link";
import { RatingTag } from "@/components/rating-tag";
import { formatPercent, formatPrice, formatWhen } from "@/lib/format";
import { levelsSentence, verdictLabel } from "@/lib/outcome-text";
import type { Scorecard } from "@/lib/scorecard";
import { cn } from "@/lib/utils";

const th = "py-2 pr-4 text-left text-sm font-normal text-muted-foreground align-bottom";
const td = "border-t border-border py-3 pr-4 align-top";

export function RunsTable({ cards, selectedId }: { cards: Scorecard[]; selectedId: string | null }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[60rem] border-collapse text-[0.9375rem]">
        <thead>
          <tr>
            <th className={th}>Run</th>
            <th className={th}>Trade date</th>
            <th className={th}>Rating</th>
            <th className={`${th} text-right`}>Entry</th>
            <th className={`${th} text-right`}>Target</th>
            <th className={`${th} text-right`}>Stop</th>
            <th className={th}>Target vs stop</th>
            <th className={`${th} text-right`}>5 days</th>
            <th className={`${th} text-right`}>20 days</th>
            <th className={th}>Beat the benchmark</th>
            <th className={th}>Absolute return</th>
          </tr>
        </thead>
        <tbody>
          {cards.map((c) => {
            const o = c.outcome;
            const s = c.report.summary;
            return (
              <tr key={c.report.id} className={cn(c.report.id === selectedId && "bg-card")}>
                <td className={td}>
                  <Link href={`?run=${encodeURIComponent(c.report.id)}`} scroll={false} aria-current={c.report.id === selectedId ? "true" : undefined} className="whitespace-nowrap underline-offset-4 hover:underline">
                    {formatWhen(c.report.runAt)}
                  </Link>
                  <div><Link href={`/reports/${encodeURIComponent(c.report.id)}`} className="text-sm text-muted-foreground underline underline-offset-4">Report</Link></div>
                </td>
                <td className={`${td} whitespace-nowrap`}>
                  {c.tradeDate.date}
                  {c.tradeDate.source === "run-date" && <div className="text-xs text-muted-foreground">inferred from run date</div>}
                </td>
                <td className={td}><RatingTag rating={s.rating} /></td>
                <td className={`${td} text-right`}>{formatPrice(o.entry?.close)}</td>
                <td className={`${td} text-right`}>{formatPrice(s.price_target)}</td>
                <td className={`${td} text-right`}>{formatPrice(s.stop_loss)}</td>
                <td className={`${td} min-w-48`}>
                  <span className="font-medium">{verdictLabel(o.levels.verdict)}</span>
                  <div className="text-sm text-muted-foreground">{levelsSentence(o.levels)}</div>
                </td>
                <td className={`${td} text-right whitespace-nowrap`}>
                  {formatPercent(o.d5.ret, { signed: true })}
                  <div className="text-xs text-muted-foreground">{formatPercent(o.d5.alpha, { signed: true })} vs {c.benchmark ?? "index"}</div>
                </td>
                <td className={`${td} text-right whitespace-nowrap`}>
                  {formatPercent(o.d20.ret, { signed: true })}
                  <div className="text-xs text-muted-foreground">{formatPercent(o.d20.alpha, { signed: true })} vs {c.benchmark ?? "index"}</div>
                </td>
                <td className={td}>{verdictLabel(o.d20.benchmark)}</td>
                <td className={td}>{verdictLabel(o.d20.absolute)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
