// ═══════════════════════════════════════════════════════════════
// local-dir-entry — Normalise mission / template working directories
// ═══════════════════════════════════════════════════════════════

import os from "os";
import { isAbsolute, resolve } from "path";

import type { LocalDirEntry } from "@/types/hermes";

/**
 * Expand a leading "~" in a path to the user's home directory.
 * Returns the input unchanged if it doesn't start with "~".
 */
function expandTilde(p: string): string {
  if (p.startsWith("~/")) {
    return resolve(os.homedir(), p.slice(2));
  }
  return p;
}

/**
 * Coerce JSON / API payloads to `LocalDirEntry[]`.
 * Accepts legacy `string[]` or `{ path, branch? }[]`.
 */
export function normalizeLocalDirsInput(raw: unknown): LocalDirEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: LocalDirEntry[] = [];
  for (const item of raw) {
    if (typeof item === "string") {
      const rawPath = item.trim();
      if (!rawPath) continue;
      const path = expandTilde(rawPath);
      if (!isAbsolute(path)) continue; // skip non-absolute paths after expansion
      out.push({ path, branch: null });
      continue;
    }
    if (item && typeof item === "object" && "path" in item) {
      const rec = item as { path: unknown; branch?: unknown };
      if (typeof rec.path !== "string") continue;
      const rawPath = rec.path.trim();
      if (!rawPath) continue;
      const path = expandTilde(rawPath);
      if (!isAbsolute(path)) continue; // skip non-absolute paths after expansion
      let branch: string | null = null;
      if (rec.branch !== undefined && rec.branch !== null && rec.branch !== "") {
        branch = String(rec.branch).trim() || null;
      }
      out.push({ path, branch });
    }
  }
  return out;
}

/** One bullet line (+ optional branch hint) for Working Directories section. */
export function formatLocalDirEntryLine(e: LocalDirEntry): string {
  const b = e.branch && String(e.branch).trim();
  if (b) {
    return `  - ${e.path}\n    Use git branch: ${b}`;
  }
  return `  - ${e.path}`;
}
