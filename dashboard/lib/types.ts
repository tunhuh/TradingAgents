export const RATINGS = ["Buy", "Overweight", "Hold", "Underweight", "Sell"] as const;
export type Rating = (typeof RATINGS)[number];

export const ANALYSTS = ["market", "social", "news", "fundamentals"] as const;
export type Analyst = (typeof ANALYSTS)[number];
export const ANALYST_LABELS: Record<Analyst, string> = {
  market: "Market",
  social: "Sentiment",
  news: "News",
  fundamentals: "Fundamentals",
};

export interface ReportSummary {
  rating: Rating;
  price_target: number | null;
  stop_loss: number | null;
  time_horizon: string | null;
  tldr: string;
  bull_points: string[];
  key_risks: string[];
  catalysts_to_watch: string[];
  model: string;
  generated_at: string;
  source_mtime: number;
}

export interface ReportListItem {
  id: string;
  ticker: string;
  /** Local wall-clock time, "YYYY-MM-DDTHH:MM:SS" (no zone). */
  runAt: string;
  summary: ReportSummary | null;
  summaryStale: boolean;
  /** complete_report.md exists, so the report can be summarized. */
  hasReport: boolean;
}

export interface ReportSection {
  key: string;
  title: string;
  markdown: string;
}

export type StepKey = "analysts" | "research" | "trading" | "risk" | "portfolio";

export interface ReportStep {
  key: StepKey;
  title: string;
  sections: ReportSection[];
}

export interface ReportDetail extends ReportListItem {
  steps: ReportStep[];
  complete: string | null;
}

export type BatchStatus = "queued" | "running" | "done" | "partial" | "failed" | "cancelled";
export type ItemStatus = "pending" | "running" | "done" | "failed" | "cancelled";

export interface BatchParams {
  tickers: string[];
  trade_date: string;
  analysts: Analyst[];
  max_debate_rounds: number;
  max_risk_discuss_rounds: number;
  auto_summarize: boolean;
}

export interface BatchItem {
  ticker: string;
  status: ItemStatus;
  started_at: string | null;
  finished_at: string | null;
  report_id: string | null;
  signal: string | null;
  summary_status: "none" | "done" | "failed";
  error: string | null;
}

export interface Batch {
  id: string;
  created_at: string;
  updated_at: string;
  status: BatchStatus;
  pid: number | null;
  error: string | null;
  params: BatchParams;
  items: BatchItem[];
}
