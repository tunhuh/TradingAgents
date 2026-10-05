import { NextResponse } from "next/server";
import { getBatch, isActive, isOrphaned, writeBatch } from "@/lib/batches";
import { NotFoundError } from "@/lib/paths";
import type { Batch } from "@/lib/types";

type Ctx = { params: Promise<{ id: string }> };

async function load(id: string): Promise<Batch | null> {
  try {
    return await getBatch(id);
  } catch (e) {
    if (e instanceof NotFoundError) return null;
    throw e;
  }
}

export async function GET(_req: Request, { params }: Ctx) {
  const batch = await load((await params).id);
  if (!batch) return NextResponse.json({ error: "Batch not found" }, { status: 404 });
  return NextResponse.json({ ...batch, active: isActive(batch), orphaned: isOrphaned(batch) });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const batch = await load((await params).id);
  if (!batch) return NextResponse.json({ error: "Batch not found" }, { status: 404 });

  if (isActive(batch) && batch.pid != null) {
    process.kill(batch.pid, "SIGTERM");
    return NextResponse.json({ ok: true, action: "signalled" });
  }
  if (isOrphaned(batch)) {
    batch.status = "failed";
    batch.error = "Worker exited unexpectedly";
    for (const item of batch.items) {
      if (item.status === "pending" || item.status === "running") item.status = "failed";
    }
    batch.updated_at = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
    await writeBatch(batch);
    return NextResponse.json({ ok: true, action: "marked-failed" });
  }
  return NextResponse.json({ ok: true, action: "none" });
}
