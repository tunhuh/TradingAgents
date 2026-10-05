import { formatWhen } from "@/lib/format";
import type { LevelsOutcome, Verdict } from "@/lib/outcomes";

const LABEL: Record<Verdict, string> = { right: "Right", wrong: "Wrong", pending: "Open", expired: "Expired", unscored: "Not scored" };

export const verdictLabel = (v: Verdict) => LABEL[v];

const day = (date: string) => formatWhen(`${date}T00:00`).replace(", 00:00", "");

export function levelsSentence(l: LevelsOutcome): string {
  if (l.note === "no price data") return "No price data yet";
  if (l.note === "no levels") return "No target or stop to score";
  if (l.note === "levels don't match the rating") return "Target and stop don’t match the rating, not scored";
  if (l.note === "Hold has no direction") {
    return l.touched && l.date ? `Hold, not scored on levels (${l.touched === "stop" ? "stop" : "target"} reached ${day(l.date)})` : "Hold, not scored on levels";
  }
  if (l.touched === "both" && l.date) return `Target and stop both hit on ${day(l.date)}, counted as a miss`;
  if (l.touched && l.date) return `${l.touched === "target" ? "Target" : "Stop"} hit on ${day(l.date)}`;
  if (l.verdict === "expired") return `Neither level hit by ${day(l.horizonEnd)}`;
  return `Open until ${day(l.horizonEnd)}${l.horizonAssumed ? " (horizon assumed 3 months)" : ""}`;
}
