export const dynamic = "force-dynamic";

// ═══════════════════════════════════════════════════════════════
// /api/bastion/state — live Bastion SSH-guard state for the Perimeter Ops page.
// Returns watched IPs, active blocks, the audit trail, and a synthesized
// activity feed (which agent did what).
// ═══════════════════════════════════════════════════════════════

import { NextResponse } from "next/server";

import { getBastionState } from "@/lib/bastion-repository";
import { logApiError } from "@/lib/api-logger";

export interface ActivityEvent {
  ts: string;
  agent: string; // gatekeeper | bastion | warden | auditor | reasoner | memory
  message: string;
  level: "info" | "warn" | "critical";
}

export async function GET() {
  try {
    const state = await getBastionState();

    // One full detect→reason→block cycle per audit row, newest first.
    const activity: ActivityEvent[] = [];
    for (const a of state.audit) {
      const lvl =
        a.severity === "CRITICAL" ? "critical" : a.severity === "WARN" ? "warn" : "info";
      activity.push({
        ts: a.ts,
        agent: "warden",
        message: `Enforced block — ${a.action_taken ?? `ipset add ${a.src_ip}`}`,
        level: lvl,
      });
      activity.push({
        ts: a.ts,
        agent: "auditor",
        message: `Sealed audit entry — ${a.src_ip} · ${a.attempt_count ?? "?"} attempts / ${a.window_seconds ?? "?"}s`,
        level: lvl,
      });
      activity.push({
        ts: a.ts,
        agent: "reasoner",
        message: `glm-5 assessed (confidence ${a.confidence ?? "?"}): ${a.reasoning ?? ""}`,
        level: lvl,
      });
      activity.push({
        ts: a.ts,
        agent: "bastion",
        message: `Brute-force from ${a.src_ip} — ${a.attempt_count ?? "?"} SSH attempts in ${a.window_seconds ?? "?"}s (${a.severity ?? ""})`,
        level: lvl,
      });
    }

    // Heartbeat line for the latest poll (Gatekeeper).
    if (state.lastEventTs) {
      const top = state.watched[0];
      activity.unshift({
        ts: state.lastEventTs,
        agent: "gatekeeper",
        message: `Watching ${state.target ?? "target"} — ${state.attemptsLastMinute} SSH attempt(s) in ${state.windowSeconds}s across ${state.watched.length} IP(s)${top ? ` · busiest ${top.src_ip} (${top.attempts})` : ""}`,
        level: state.incidentActive ? "warn" : "info",
      });
    }

    return NextResponse.json({ data: { ...state, activity } });
  } catch (error) {
    logApiError("GET /api/bastion/state", "loading bastion state", error);
    return NextResponse.json({ error: "Failed to load Bastion state" }, { status: 500 });
  }
}
