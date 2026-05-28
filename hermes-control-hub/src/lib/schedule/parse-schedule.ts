/**
 * Hermes-compatible schedule parsing for Control Hub.
 * Supports interval, cron, and ISO one-shot formats used with Hermes `jobs.json`.
 */

import type { ParsedSchedule } from "./types";

/** Check if a string looks like a cron expression (5+ space-separated cron fields). */
export function looksLikeCronExpression(s: string): boolean {
  if (!s || typeof s !== "string") return false;
  const parts = s.trim().split(/\s+/);
  return parts.length >= 5 && parts.every((p) => /^[*\-,\/0-9]+$/.test(p));
}

/**
 * Parse a schedule string for Hermes `jobs.json`.
 */
export function parseSchedule(raw: string): ParsedSchedule {
  const s = (typeof raw === "string" ? raw : "").trim();

  if (!s) {
    return { kind: "invalid", raw: "", message: "Schedule is empty" };
  }

  const simpleIntervalMatch = s.match(/^(?:every\s+)?(\d+)\s*(m|min|minutes?|h|hr|hours?|d|day|days?)$/i);
  if (simpleIntervalMatch) {
    const n = parseInt(simpleIntervalMatch[1], 10);
    const unit = simpleIntervalMatch[2].toLowerCase();
    let minutes: number;
    if (unit.startsWith("h")) {
      minutes = n * 60;
    } else if (unit.startsWith("d")) {
      minutes = n * 1440;
    } else {
      minutes = n;
    }
    return { kind: "interval", minutes, display: `every ${minutes}m` };
  }

  if (looksLikeCronExpression(s)) {
    return { kind: "cron", expr: s, display: s };
  }

  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) {
    return { kind: "once", run_at: s, display: s };
  }

  return {
    kind: "invalid",
    raw: s,
    message: `Unrecognized schedule: ${s.slice(0, 120)}`,
  };
}
