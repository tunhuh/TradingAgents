import fs from "node:fs/promises";
import { NextResponse } from "next/server";
import { localRequestError } from "@/lib/guard";
import { NotFoundError, decodeRouteParam, resolveReportDir } from "@/lib/paths";
import { lastLine, runWorker } from "@/lib/python";
import { readSummary } from "@/lib/reports";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Ctx) {
  const denied = localRequestError(req);
  if (denied) return NextResponse.json({ error: denied }, { status: 403 });
  let id: string;
  let dir: string;
  try {
    id = decodeRouteParam((await params).id);
    dir = resolveReportDir(id);
    if (!(await fs.stat(dir).catch(() => null))?.isDirectory()) throw new NotFoundError(id);
  } catch (e) {
    if (e instanceof NotFoundError) return NextResponse.json({ error: "Report not found" }, { status: 404 });
    throw e;
  }

  let result;
  try {
    result = await runWorker("dashboard.worker.summarize", [id], 180_000);
  } catch (e) {
    return NextResponse.json({ error: `Could not start the Python worker: ${(e as Error).message}` }, { status: 500 });
  }
  if (result.code !== 0) {
    return NextResponse.json(
      { error: lastLine(result.stderr) || `Summarizer exited with code ${result.code}` },
      { status: 500 },
    );
  }
  const { summary } = await readSummary(dir);
  return summary
    ? NextResponse.json(summary)
    : NextResponse.json({ error: "Summarizer finished but wrote no summary" }, { status: 500 });
}
