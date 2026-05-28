/**
 * Hermes log file basenames (no directory, no .log suffix in API `name` param).
 */

import { existsSync, readdirSync, statSync } from "fs";
import { relative, resolve } from "path";

export const MAX_LOG_BASENAME_LEN = 128;

export type LogFileGroup = "core" | "system" | "other";

export interface LogFileMeta {
  name: string;
  size: number;
  modified: string;
  group: LogFileGroup;
}

/** Allowed characters: letters, digits, dot, underscore, hyphen (no path segments). */
const BASENAME_RE = /^[a-zA-Z0-9._-]+$/;

/**
 * Validate and normalise a log basename for `name` query/body.
 * Returns null if invalid (rejects `..`, empty, oversize, bad chars).
 */
export function sanitizeLogBasename(raw: string): string | null {
  let s = raw.trim();
  if (s.toLowerCase().endsWith(".log")) {
    s = s.slice(0, -4).trim();
  }
  if (!s || s.includes("..") || s.includes("/") || s.includes("\\")) {
    return null;
  }
  if (s.length > MAX_LOG_BASENAME_LEN) {
    return null;
  }
  if (!BASENAME_RE.test(s)) {
    return null;
  }
  return s;
}

export function categorizeLogFileGroup(name: string): LogFileGroup {
  const lower = name.toLowerCase();
  if (lower === "agent" || lower === "errors" || lower === "gateway") {
    return "core";
  }
  if (lower.startsWith("ch-")) {
    return "system";
  }
  return "other";
}

const LOG_SORT_PRIORITY: Record<string, number> = {
  agent: 0,
  errors: 1,
  gateway: 2,
};

export function compareLogFileNames(a: string, b: string): number {
  const pa = LOG_SORT_PRIORITY[a] ?? 10;
  const pb = LOG_SORT_PRIORITY[b] ?? 10;
  if (pa !== pb) return pa - pb;
  return a.localeCompare(b);
}

/**
 * Verify that a resolved log file path falls within the logs directory.
 * Prevents path traversal attacks via symlinks or .. components.
 */
export function logFileUnderLogsDir(logsDir: string, logPath: string): boolean {
  const R = resolve(logsDir);
  const C = resolve(logPath);
  if (C === R) return false;
  const rel = relative(R, C);
  return rel !== "" && !rel.startsWith("..") && !rel.includes("..");
}

/**
 * Collect available `.log` files from a directory.
 * Returns sorted by name priority (core first, then system, then other).
 */
export function listLogFilesInDir(logsDir: string): LogFileMeta[] {
  if (!existsSync(logsDir)) return [];

  const files = readdirSync(logsDir);
  const logs: LogFileMeta[] = [];

  for (const file of files) {
    if (!file.endsWith(".log")) continue;
    const base = file.slice(0, -4);
    if (sanitizeLogBasename(base) !== base) continue;
    const filePath = resolve(logsDir, file);
    const stats = statSync(filePath);
    logs.push({
      name: base,
      size: stats.size,
      modified: stats.mtime.toISOString(),
      group: categorizeLogFileGroup(base),
    });
  }

  logs.sort((a, b) => compareLogFileNames(a.name, b.name));
  return logs;
}
