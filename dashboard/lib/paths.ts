import path from "node:path";

export class NotFoundError extends Error {}

export function repoRoot(): string {
  // turbopackIgnore: these are runtime paths outside the app; nothing to trace into the build.
  return path.resolve(/*turbopackIgnore: true*/ process.env.TA_REPO_ROOT ?? path.join(process.cwd(), ".."));
}

export function reportsDir(): string {
  return path.resolve(/*turbopackIgnore: true*/ process.env.TA_REPORTS_DIR ?? path.join(repoRoot(), "reports"));
}

export function batchesDir(): string {
  return path.join(reportsDir(), "_batches");
}

export function pythonBin(): string {
  return process.env.TA_PYTHON ?? path.join(repoRoot(), ".venv", "bin", "python");
}

// First char excludes "_" so internal folders like _batches are never addressable as reports.
const REPORT_ID_RE = /^[A-Za-z0-9.\-^=+][A-Za-z0-9._\-^=+]*$/;
export const BATCH_ID_RE = /^\d{8}_\d{6}_[0-9a-f]{4}$/;

export function resolveReportDir(id: string): string {
  if (!REPORT_ID_RE.test(id) || /^\.+$/.test(id)) throw new NotFoundError(`Unknown report: ${id}`);
  const base = reportsDir();
  const dir = path.resolve(base, id);
  if (path.dirname(dir) !== base) throw new NotFoundError(`Unknown report: ${id}`);
  return dir;
}

export function resolveBatchFile(id: string): string {
  if (!BATCH_ID_RE.test(id)) throw new NotFoundError(`Unknown batch: ${id}`);
  return path.join(batchesDir(), `${id}.json`);
}
