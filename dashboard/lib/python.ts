import { spawn } from "node:child_process";
import fs from "node:fs";
import { pythonBin, repoRoot, reportsDir } from "@/lib/paths";

function workerEnv(): NodeJS.ProcessEnv {
  return { ...process.env, TA_REPORTS_DIR: reportsDir(), PYTHONUNBUFFERED: "1" };
}

/** Start a detached worker that outlives this request (and the dev server). Resolves with its pid. */
export function spawnWorker(module: string, args: string[], logFile: string): Promise<number> {
  const log = fs.openSync(logFile, "a");
  return new Promise((resolve, reject) => {
    const child = spawn(pythonBin(), ["-m", module, ...args], {
      cwd: repoRoot(),
      env: workerEnv(),
      detached: true,
      stdio: ["ignore", log, log],
    });
    child.once("error", (err) => {
      fs.closeSync(log);
      reject(err);
    });
    child.once("spawn", () => {
      fs.closeSync(log);
      child.unref();
      resolve(child.pid!);
    });
  });
}

/** Run a worker to completion and capture stderr (last 10 KB). */
export function runWorker(module: string, args: string[], timeoutMs: number): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(pythonBin(), ["-m", module, ...args], {
      cwd: repoRoot(),
      env: workerEnv(),
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr = (stderr + chunk.toString()).slice(-10_000);
    });
    const timer = setTimeout(() => {
      stderr += `\nTimed out after ${Math.round(timeoutMs / 1000)}s`;
      child.kill("SIGTERM");
    }, timeoutMs);
    child.once("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stderr });
    });
  });
}

/** Last non-empty line of a worker's stderr — its one-line error message. */
export function lastLine(text: string): string {
  return text.trim().split("\n").pop() ?? "";
}
