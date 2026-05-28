// ═══════════════════════════════════════════════════════════════
// cron-display.ts — Shared cron expression → human-readable label
// ═══════════════════════════════════════════════════════════════
//
// Converts cron expressions and interval strings into human-readable
// labels for display in the UI. Handles all patterns produced by
// parseSchedule() (Hermes jobs.json surface).
//
// Consumers: IntervalSelector, ScheduleSelector, JobCard.

/**
 * Parse a cron expression (or "every N" string) and return a human-readable label.
 * Handles all common patterns: star-slash-N, zero star-slash-N, daily, weekly, monthly, weekdays, etc.
 * Returns null if the expression doesn't match any known pattern.
 */
export function parseCronExpression(expr: string): string | null {
  if (!expr) return null;
  const trimmed = expr.trim();

  // Handle "every N" format (used by the cron API)
  // e.g. "every 5m", "every 60m", "every 1h", "every 12h", "every 7d"
  const everyMatch = trimmed.match(/^every\s+(\d+)([mhd])$/i);
  if (everyMatch) {
    const num = parseInt(everyMatch[1]);
    const unit = everyMatch[2].toLowerCase();
    if (unit === "m") {
      if (num >= 60) {
        const h = Math.floor(num / 60);
        const m = num % 60;
        if (m === 0) return h === 1 ? "1 hour" : `${h} hours`;
        return `${h}h ${m}m`;
      }
      return num === 1 ? "1 minute" : `${num} minutes`;
    }
    if (unit === "h") return num === 1 ? "1 hour" : `${num} hours`;
    if (unit === "d") return num === 1 ? "1 day" : `${num} days`;
  }

  const parts = trimmed.split(/\s+/);
  if (parts.length < 5) return null;
  const [min, hour, dom, mon, dow] = parts;

  // Every N minutes: */N * * * *
  if (min.startsWith("*/") && hour === "*" && dom === "*" && mon === "*" && dow === "*") {
    return `Every ${min.slice(2)}m`;
  }

  // Every N hours: 0 */N * * *
  if (min === "0" && hour.startsWith("*/") && dom === "*" && mon === "*" && dow === "*") {
    return `Every ${hour.slice(2)}h`;
  }

  // Every hour at MM past: MM * * * *
  if (min !== "*" && hour === "*" && dom === "*" && mon === "*" && dow === "*") {
    const m = parseInt(min);
    if (Number.isFinite(m) && m >= 0 && m <= 59) {
      return `Hourly :${String(m).padStart(2, "0")}`;
    }
  }

  // Every minute: * * * * *
  if (min === "*" && hour === "*" && dom === "*" && mon === "*" && dow === "*") {
    return "Every minute";
  }

  // Daily at HH:MM: 0 HH * * *
  if (min !== "*" && hour !== "*" && dom === "*" && mon === "*" && dow === "*") {
    const h = parseInt(hour);
    const m = parseInt(min);
    if (Number.isFinite(h) && Number.isFinite(m)) {
      const period = h >= 12 ? "PM" : "AM";
      const displayHour = h === 0 ? 12 : h > 12 ? h - 12 : h;
      const displayMin = String(m).padStart(2, "0");
      return `Daily ${displayHour}:${displayMin}${period}`;
    }
  }

  // Weekly on specific day: 0 HH * * D
  if (min !== "*" && hour !== "*" && dom === "*" && mon === "*" && dow !== "*") {
    const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const dayIndex = parseInt(dow);
    const h = parseInt(hour);
    const m = parseInt(min);
    if (Number.isFinite(dayIndex) && dayIndex >= 0 && dayIndex <= 6 && Number.isFinite(h) && Number.isFinite(m)) {
      const period = h >= 12 ? "PM" : "AM";
      const displayHour = h === 0 ? 12 : h > 12 ? h - 12 : h;
      const displayMin = String(m).padStart(2, "0");
      return `${days[dayIndex]}s ${displayHour}:${displayMin}${period}`;
    }
  }

  // Monthly: 0 HH DD * *
  if (min !== "*" && hour !== "*" && dom !== "*" && mon === "*" && dow === "*") {
    const h = parseInt(hour);
    const m = parseInt(min);
    const d = parseInt(dom);
    if (Number.isFinite(h) && Number.isFinite(m) && Number.isFinite(d)) {
      const period = h >= 12 ? "PM" : "AM";
      const displayHour = h === 0 ? 12 : h > 12 ? h - 12 : h;
      const displayMin = String(m).padStart(2, "0");
      return `Day ${d} ${displayHour}:${displayMin}${period}`;
    }
  }

  // Weekdays (1-5): 0 HH * * 1-5
  if (min !== "*" && hour !== "*" && dom === "*" && mon === "*" && /^[1-5](,[1-5])*$/.test(dow)) {
    const h = parseInt(hour);
    const m = parseInt(min);
    if (Number.isFinite(h) && Number.isFinite(m)) {
      const period = h >= 12 ? "PM" : "AM";
      const displayHour = h === 0 ? 12 : h > 12 ? h - 12 : h;
      const displayMin = String(m).padStart(2, "0");
      return `Weekdays ${displayHour}:${displayMin}${period}`;
    }
  }

  return null;
}
