// ═══════════════════════════════════════════════════════════════
// Sentinel Ops — live agent flow (n8n-style nodes + edges) + activity feed
// ═══════════════════════════════════════════════════════════════

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Satellite, Radar, ShieldAlert, BookOpen, ScrollText, Database,
  Cpu, Activity, AlertTriangle, CircleDot,
} from "lucide-react";
import PageHeader from "@/components/layout/PageHeader";
import AppPageShell from "@/components/layout/AppPageShell";

// ── Types (mirror /api/sentinel/state) ───────────────────────────

interface TelemetrySample {
  ts: string;
  target: string | null;
  processor_load: number | null;
  ram_saturation: number | null;
  active_subsys: number | null;
  top_proc: string | null;
  top_cpu: number | null;
  severity: string;
}
interface AuditEntry {
  id: number;
  ts: string;
  target: string | null;
  severity: string | null;
  culprit_proc: string | null;
  culprit_pid: number | null;
  culprit_cpu: number | null;
  sop_ref: string | null;
  reasoning: string | null;
  confidence: number | null;
}
interface ActivityEvent {
  ts: string;
  agent: string;
  message: string;
  level: "info" | "warn" | "critical";
}
interface SentinelState {
  ready: boolean;
  target: string | null;
  latest: TelemetrySample | null;
  history: TelemetrySample[];
  audit: AuditEntry[];
  incidentActive: boolean;
  activity: ActivityEvent[];
}

// ── Node graph definition ────────────────────────────────────────

type NodeId = "target" | "watchtower" | "sentinel" | "archivist" | "auditor" | "memory";

interface FlowNode {
  id: NodeId;
  label: string;
  sub: string;
  badge?: string;
  icon: React.ComponentType<{ className?: string }>;
  x: number;
  y: number;
}

const NODE_W = 184;
const NODE_H = 74;
const CANVAS_W = 980;
const CANVAS_H = 440;

const NODES: FlowNode[] = [
  { id: "target",     label: "Target",     sub: "space-armour-server", icon: Satellite,   x: 24,  y: 184 },
  { id: "watchtower", label: "Watchtower", sub: "Telemetry monitor",   icon: Radar,       x: 252, y: 184 },
  { id: "sentinel",   label: "Sentinel",   sub: "Detect & reason",     badge: "glm-5", icon: ShieldAlert, x: 480, y: 184 },
  { id: "archivist",  label: "Archivist",  sub: "SOP knowledge base",  icon: BookOpen,    x: 760, y: 56  },
  { id: "auditor",    label: "Auditor",    sub: "Audit trail",         icon: ScrollText,  x: 760, y: 184 },
  { id: "memory",     label: "Memory",     sub: "mem0 + Hindsight",    icon: Database,    x: 760, y: 312 },
];

const EDGES: [NodeId, NodeId][] = [
  ["target", "watchtower"],
  ["watchtower", "sentinel"],
  ["sentinel", "archivist"],
  ["sentinel", "auditor"],
  ["sentinel", "memory"],
];

const nodeById = (id: NodeId) => NODES.find((n) => n.id === id)!;

// ── Visual helpers ───────────────────────────────────────────────

const AGENT_COLOR: Record<string, string> = {
  target: "#38bdf8",     // sky
  watchtower: "#22d3ee", // cyan
  sentinel: "#a855f7",   // purple
  archivist: "#34d399",  // green
  auditor: "#f59e0b",    // amber
  memory: "#ec4899",     // pink
  reasoner: "#a855f7",
};

function severityColor(sev: string | null | undefined): string {
  if (sev === "CRITICAL") return "#ef4444";
  if (sev === "WARN") return "#f59e0b";
  return "#22c55e";
}

function edgePath(from: FlowNode, to: FlowNode): string {
  const x1 = from.x + NODE_W;
  const y1 = from.y + NODE_H / 2;
  const x2 = to.x;
  const y2 = to.y + NODE_H / 2;
  const dx = Math.max(40, (x2 - x1) / 2);
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
}

function timeAgo(ts: string): string {
  const s = Math.max(0, Math.floor((Date.now() - new Date(ts).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

// ── Page ─────────────────────────────────────────────────────────

export default function SentinelOpsPage() {
  const [state, setState] = useState<SentinelState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const feedRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/sentinel/state", { cache: "no-store" });
      const json = await res.json();
      if (json.error) setError(json.error);
      else { setState(json.data); setError(null); }
    } catch {
      setError("Failed to reach the Sentinel API");
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 2500);
    return () => clearInterval(t);
  }, [load]);

  const incident = state?.incidentActive ?? false;
  const sev = state?.latest?.severity ?? "NORMAL";

  // Which nodes are "lit".
  const activeNode = (id: NodeId): boolean => {
    if (id === "target" || id === "watchtower") return true; // always live
    return incident; // detection pipeline lights up during an incident
  };
  const edgeActive = (to: NodeId): boolean => activeNode(to) && (to === "watchtower" || incident);

  return (
    <AppPageShell>
      <PageHeader
        title="Sentinel Ops"
        subtitle="Live autonomous-ops pipeline — who is running and what they are doing"
        icon={Activity}
        color="purple"
        status={incident ? "warning" : "online"}
      />

      {/* Status strip */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
        <StatCard label="Target" value={state?.target ?? "—"} mono />
        <StatCard
          label="Status"
          value={incident ? sev : "NOMINAL"}
          color={incident ? severityColor(sev) : "#22c55e"}
          pulse={incident}
        />
        <StatCard label="CPU" value={state?.latest ? `${state.latest.processor_load ?? 0}%` : "—"} color={severityColor(sev)} />
        <StatCard label="RAM" value={state?.latest ? `${state.latest.ram_saturation ?? 0}%` : "—"} />
        <StatCard label="Top process" value={state?.latest?.top_proc ?? "—"} mono />
      </div>

      <div className="flex flex-col xl:flex-row gap-4">
        {/* Flow canvas */}
        <div className="flex-1 min-w-0 rounded-2xl border border-white/10 bg-[#0c0e14] overflow-auto relative">
          <div className="absolute top-3 left-4 text-xs uppercase tracking-wider text-white/30">
            Agent Pipeline
          </div>
          <div className="relative mx-auto" style={{ width: CANVAS_W, height: CANVAS_H }}>
            {/* edges */}
            <svg className="absolute inset-0" width={CANVAS_W} height={CANVAS_H} style={{ pointerEvents: "none" }}>
              <defs>
                <marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
                  <path d="M0,0 L6,3 L0,6 Z" fill="#475569" />
                </marker>
                <marker id="arrowActive" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
                  <path d="M0,0 L6,3 L0,6 Z" fill="#a855f7" />
                </marker>
              </defs>
              {EDGES.map(([from, to]) => {
                const active = edgeActive(to);
                return (
                  <path
                    key={`${from}-${to}`}
                    d={edgePath(nodeById(from), nodeById(to))}
                    fill="none"
                    stroke={active ? AGENT_COLOR[to] : "#334155"}
                    strokeWidth={active ? 2.5 : 1.5}
                    markerEnd={active ? "url(#arrowActive)" : "url(#arrow)"}
                    strokeDasharray={active ? "6 6" : undefined}
                    className={active ? "sentinel-flow" : undefined}
                    opacity={active ? 1 : 0.5}
                  />
                );
              })}
            </svg>

            {/* nodes */}
            {NODES.map((n) => {
              const Icon = n.icon;
              const on = activeNode(n.id);
              const color = AGENT_COLOR[n.id];
              const crit = incident && n.id !== "target" && n.id !== "watchtower" && sev === "CRITICAL";
              return (
                <div
                  key={n.id}
                  className="absolute rounded-xl border bg-[#11141d] transition-all duration-300"
                  style={{
                    left: n.x, top: n.y, width: NODE_W, height: NODE_H,
                    borderColor: on ? color : "rgba(255,255,255,0.08)",
                    boxShadow: on ? `0 0 0 1px ${color}40, 0 0 22px ${crit ? "#ef444455" : color + "33"}` : "none",
                  }}
                >
                  <div className="flex items-center gap-3 h-full px-3">
                    <div
                      className="shrink-0 w-10 h-10 rounded-lg flex items-center justify-center"
                      style={{ background: `${color}1a`, color }}
                    >
                      <Icon className="w-5 h-5" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-semibold text-white truncate">{n.label}</span>
                        {on && (
                          <CircleDot
                            className="w-3 h-3 shrink-0"
                            style={{ color }}
                          />
                        )}
                      </div>
                      <div className="text-[11px] text-white/40 truncate">{n.sub}</div>
                      {n.badge && (
                        <span className="inline-flex items-center gap-1 mt-0.5 px-1.5 py-0.5 rounded bg-purple-500/15 text-[10px] text-purple-300 font-mono">
                          <Cpu className="w-2.5 h-2.5" /> {n.badge}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Activity feed */}
        <div className="xl:w-[360px] shrink-0 rounded-2xl border border-white/10 bg-[#0c0e14] flex flex-col max-h-[520px]">
          <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between">
            <span className="text-xs uppercase tracking-wider text-white/40">Live Activity</span>
            {incident ? (
              <span className="inline-flex items-center gap-1 text-[11px] text-red-400">
                <AlertTriangle className="w-3 h-3" /> incident
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-[11px] text-green-400">
                <CircleDot className="w-3 h-3" /> monitoring
              </span>
            )}
          </div>
          <div ref={feedRef} className="flex-1 overflow-auto p-2 space-y-1">
            {error && <div className="text-xs text-red-400 p-2">{error}</div>}
            {state && state.activity.length === 0 && (
              <div className="text-xs text-white/30 p-2">Waiting for telemetry…</div>
            )}
            {state?.activity.map((e, i) => (
              <div
                key={`${e.ts}-${i}`}
                className="rounded-lg px-2.5 py-2 bg-white/[0.02] border border-white/5"
              >
                <div className="flex items-center justify-between gap-2">
                  <span
                    className="text-[11px] font-semibold uppercase tracking-wide"
                    style={{ color: AGENT_COLOR[e.agent] ?? "#94a3b8" }}
                  >
                    {e.agent}
                  </span>
                  <span className="text-[10px] text-white/30">{timeAgo(e.ts)}</span>
                </div>
                <div
                  className={`text-xs mt-0.5 leading-snug ${
                    e.level === "critical" ? "text-red-300"
                      : e.level === "warn" ? "text-amber-300" : "text-white/70"
                  }`}
                >
                  {e.message}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Latest incident reasoning */}
      {state?.audit?.[0] && (
        <div className="mt-4 rounded-2xl border border-white/10 bg-[#0c0e14] p-4">
          <div className="text-xs uppercase tracking-wider text-white/40 mb-2">
            Latest decision — {timeAgo(state.audit[0].ts)}
          </div>
          <div className="flex flex-wrap items-center gap-2 mb-2 text-xs">
            <Badge color={severityColor(state.audit[0].severity)}>{state.audit[0].severity}</Badge>
            <span className="text-white/50">culprit:</span>
            <span className="font-mono text-white/80">
              {state.audit[0].culprit_proc} (pid {state.audit[0].culprit_pid}, {state.audit[0].culprit_cpu}% CPU)
            </span>
            <span className="text-white/50">· SOP:</span>
            <span className="font-mono text-white/80">{state.audit[0].sop_ref}</span>
            <span className="text-white/50">· confidence:</span>
            <span className="font-mono text-white/80">{state.audit[0].confidence}</span>
          </div>
          <p className="text-sm text-white/70 leading-relaxed">{state.audit[0].reasoning}</p>
        </div>
      )}
    </AppPageShell>
  );
}

// ── Small presentational helpers ─────────────────────────────────

function StatCard({
  label, value, color, mono, pulse,
}: { label: string; value: string; color?: string; mono?: boolean; pulse?: boolean }) {
  return (
    <div className="rounded-xl border border-white/10 bg-[#0c0e14] px-3 py-2.5">
      <div className="text-[10px] uppercase tracking-wider text-white/35">{label}</div>
      <div
        className={`mt-0.5 text-base font-semibold truncate ${mono ? "font-mono text-sm" : ""} ${pulse ? "animate-pulse" : ""}`}
        style={{ color: color ?? "#fff" }}
      >
        {value}
      </div>
    </div>
  );
}

function Badge({ children, color }: { children: React.ReactNode; color: string }) {
  return (
    <span
      className="px-2 py-0.5 rounded text-[11px] font-semibold"
      style={{ background: `${color}22`, color }}
    >
      {children}
    </span>
  );
}
