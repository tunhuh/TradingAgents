import { NextResponse } from "next/server";
import {
  batchLogPath, createBatchRecord, findActiveBatch, listBatches, newBatchId, validateParams, writeBatch,
} from "@/lib/batches";
import { pythonBin } from "@/lib/paths";
import { spawnWorker } from "@/lib/python";

export async function GET() {
  return NextResponse.json(await listBatches());
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON" }, { status: 400 });
  }
  const v = validateParams(body);
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });

  const active = await findActiveBatch();
  if (active) {
    return NextResponse.json({ error: "A batch is already running", activeBatchId: active.id }, { status: 409 });
  }

  const batch = createBatchRecord(v.params, newBatchId());
  await writeBatch(batch);
  try {
    await spawnWorker("dashboard.worker.run_batch", [batch.id], batchLogPath(batch.id));
  } catch (e) {
    batch.status = "failed";
    batch.error = `Could not start the Python worker (${pythonBin()}): ${(e as Error).message}. Set TA_PYTHON.`;
    await writeBatch(batch);
    return NextResponse.json({ error: batch.error }, { status: 500 });
  }
  return NextResponse.json({ id: batch.id }, { status: 201 });
}
