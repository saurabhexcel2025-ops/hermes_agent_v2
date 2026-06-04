export const dynamic = "force-dynamic";

// ═══════════════════════════════════════════════════════════════
// /api/sentinel/state — live Sentinel pipeline state for the Ops page
// Returns latest telemetry, short history, recent audit trail, and a
// synthesized activity feed (which agent did what).
// ═══════════════════════════════════════════════════════════════

import { NextResponse } from "next/server";

import { getSentinelState } from "@/lib/sentinel-repository";
import { logApiError } from "@/lib/api-logger";

export interface ActivityEvent {
  ts: string;
  agent: string; // watchtower | sentinel | archivist | reasoner | auditor
  message: string;
  level: "info" | "warn" | "critical";
}

export async function GET() {
  try {
    const state = await getSentinelState();

    // Build a human-readable activity feed from the audit trail (each audit row
    // = one full detect→reason→log cycle), newest first.
    const activity: ActivityEvent[] = [];
    for (const a of state.audit) {
      const lvl =
        a.severity === "CRITICAL" ? "critical" : a.severity === "WARN" ? "warn" : "info";
      activity.push({
        ts: a.ts,
        agent: "auditor",
        message: `Sealed audit entry — ${a.culprit_proc ?? "?"} (${a.culprit_cpu ?? "?"}% CPU), SOP ${a.sop_ref ?? "n/a"}`,
        level: lvl,
      });
      activity.push({
        ts: a.ts,
        agent: "reasoner",
        message: `glm-5 reasoned (confidence ${a.confidence ?? "?"}): ${a.reasoning ?? ""}`,
        level: lvl,
      });
      activity.push({
        ts: a.ts,
        agent: "archivist",
        message: `Retrieved SOP "${a.sop_ref ?? "n/a"}" for ${a.severity ?? ""} anomaly`,
        level: lvl,
      });
      activity.push({
        ts: a.ts,
        agent: "sentinel",
        message: `Anomaly detected on ${a.target ?? "target"} — ${a.anomaly ?? ""}`,
        level: lvl,
      });
    }
    // A heartbeat line for the latest poll (Watchtower).
    if (state.latest) {
      activity.unshift({
        ts: state.latest.ts,
        agent: "watchtower",
        message: `Polled ${state.latest.target ?? "target"} — CPU ${state.latest.processor_load ?? "?"}% · RAM ${state.latest.ram_saturation ?? "?"}% · ${state.latest.active_subsys ?? "?"} subsystems · top: ${state.latest.top_proc ?? "?"}`,
        level:
          state.latest.severity === "CRITICAL"
            ? "critical"
            : state.latest.severity === "WARN"
              ? "warn"
              : "info",
      });
    }

    return NextResponse.json({ data: { ...state, activity } });
  } catch (error) {
    logApiError("GET /api/sentinel/state", "loading sentinel state", error);
    return NextResponse.json({ error: "Failed to load Sentinel state" }, { status: 500 });
  }
}
