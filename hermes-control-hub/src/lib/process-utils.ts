// ═══════════════════════════════════════════════════════════════
// process-utils.ts — Shared child_process utilities
// ═══════════════════════════════════════════════════════════════
// Async wrappers around child_process.spawn and execSync.
// Compatible with Turbopack/Next.js bundling (no child_process/promises).
// ═══════════════════════════════════════════════════════════════

import { spawn } from "child_process";

/**
 * Run an executable with args, optional stdin input, and return { stdout, stderr }.
 * Async wrapper around child_process.spawn. Does NOT go through a shell.
 * Compatible with Turbopack/Next.js bundling (no child_process/promises).
 */
export function spawnAsync(
  cmd: string,
  args: string[],
  opts: { input?: string; encoding?: string; timeout?: number; killSignal?: NodeJS.Signals } = {},
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timer: ReturnType<typeof setTimeout> | null = null;

    child.stdout!.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr!.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });

    if (opts.timeout && opts.timeout > 0) {
      timer = setTimeout(() => {
        child.kill((opts.killSignal || "SIGTERM") as NodeJS.Signals);
      }, opts.timeout);
    }

    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(stderr || stdout || `exit code ${code}`));
      } else {
        resolve({ stdout, stderr });
      }
    });
    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      reject(err);
    });

    if (opts.input) {
      child.stdin!.write(opts.input);
      child.stdin!.end();
    } else {
      child.stdin!.end();
    }
  });
}

/** Extract error message from an unknown child_process error (stderr/stdout/message). */
export function formatProcessError(err: unknown): string {
  const e = err as { stderr?: string; stdout?: string; message?: string };
  return e.stderr ?? e.stdout ?? e.message ?? "Unknown error";
}
