import { NextResponse } from "next/server";
import {
  batchLogPath, createBatchRecord, findActiveBatch, getBatch, listBatches, newBatchId, validateParams, writeBatch,
} from "@/lib/batches";
import { localRequestError } from "@/lib/guard";
import { pythonBin } from "@/lib/paths";
import { spawnWorker } from "@/lib/python";

export async function GET() {
  return NextResponse.json(await listBatches());
}

export async function POST(req: Request) {
  const denied = localRequestError(req, { requireJson: true });
  if (denied) return NextResponse.json({ error: denied }, { status: 403 });
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
  let pid: number;
  try {
    pid = await spawnWorker("dashboard.worker.run_batch", [batch.id], batchLogPath(batch.id));
  } catch (e) {
    batch.status = "failed";
    batch.error = `Could not start the Python worker (${pythonBin()}): ${(e as Error).message}. Set TA_PYTHON.`;
    await writeBatch(batch);
    return NextResponse.json({ error: batch.error }, { status: 500 });
  }
  // Record the pid now, so a worker that dies during startup frees the batch at once instead of
  // after the queued grace period. Only while the worker hasn't written its own state yet.
  const current = await getBatch(batch.id).catch(() => null);
  if (current && current.pid == null && current.status === "queued") {
    current.pid = pid;
    await writeBatch(current);
  }
  return NextResponse.json({ id: batch.id }, { status: 201 });
}
