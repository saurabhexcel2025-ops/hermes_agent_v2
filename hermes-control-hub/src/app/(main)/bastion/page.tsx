// ═══════════════════════════════════════════════════════════════
// Perimeter Ops — live Bastion SSH-guard flow (n8n-style nodes + edges) +
// activity feed + active blocks. A single pulse sweeps the pipeline in order
// and only the node currently being processed is highlighted, in sync with the
// pulse. Mirrors the Sentinel Ops page; Bastion enforces (blocks IPs).
// ═══════════════════════════════════════════════════════════════

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Server, ScanLine, ShieldAlert, Ban, ScrollText, Database,
  Cpu, ShieldCheck, AlertTriangle, CircleDot,
} from "lucide-react";
import PageHeader from "@/components/layout/PageHeader";
import AppPageShell from "@/components/layout/AppPageShell";

// ── Types (mirror /api/bastion/state) ────────────────────────────

interface WatchedIp {
  src_ip: string;
  attempts: number;
  last_ts: string;
  blocked: boolean;
}
interface ActiveBlock {
  id: number;
  src_ip: string;
  target: string | null;
  blocked_at: string;
  expires_at: string;
  attempt_count: number | null;
  reason: string | null;
}
interface SshAuditEntry {
  id: number;
  ts: string;
  target: string | null;
  src_ip: string | null;
  attempt_count: number | null;
  window_seconds: number | null;
  severity: string | null;
  sop_ref: string | null;
  reasoning: string | null;
  confidence: number | null;
  action_taken: string | null;
}
interface ActivityEvent {
  ts: string;
  agent: string;
  message: string;
  level: "info" | "warn" | "critical";
}
interface BastionState {
  ready: boolean;
  target: string | null;
  windowSeconds: number;
  attemptThreshold: number;
  attemptsLastMinute: number;
  watched: WatchedIp[];
  activeBlocks: ActiveBlock[];
  audit: SshAuditEntry[];
  lastEventTs: string | null;
  incidentActive: boolean;
  activity: ActivityEvent[];
}

// ── Node graph definition ────────────────────────────────────────

type NodeId = "target" | "gatekeeper" | "bastion" | "warden" | "auditor" | "memory";

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
  { id: "target",     label: "Target",     sub: "space-armour-server", icon: Server,      x: 24,  y: 184 },
  { id: "gatekeeper", label: "Gatekeeper", sub: "SSH log monitor",     icon: ScanLine,    x: 252, y: 184 },
  { id: "bastion",    label: "Bastion",    sub: "Detect & reason",     badge: "glm-5", icon: ShieldAlert, x: 480, y: 184 },
  { id: "warden",     label: "Warden",     sub: "Block (ipset 1h)",    icon: Ban,         x: 760, y: 56  },
  { id: "auditor",    label: "Auditor",    sub: "SSH audit trail",     icon: ScrollText,  x: 760, y: 184 },
  { id: "memory",     label: "Memory",     sub: "mem0 + Hindsight",    icon: Database,    x: 760, y: 312 },
];

const EDGES: [NodeId, NodeId][] = [
  ["target", "gatekeeper"],
  ["gatekeeper", "bastion"],
  ["bastion", "warden"],
  ["bastion", "auditor"],
  ["bastion", "memory"],
];

const nodeById = (id: NodeId) => NODES.find((n) => n.id === id)!;

// stage 0: target → gatekeeper
// stage 1: gatekeeper → bastion
// stage 2: bastion → {warden, auditor, memory}  (severity sets the colour)
const STAGE_MS = 750;
const EDGE_STAGE: Record<string, number> = {
  "target>gatekeeper": 0,
  "gatekeeper>bastion": 1,
  "bastion>warden": 2,
  "bastion>auditor": 2,
  "bastion>memory": 2,
};
const NODE_STAGE: Partial<Record<NodeId, number>> = {
  gatekeeper: 0,
  bastion: 1,
  warden: 2,
  auditor: 2,
  memory: 2,
};

// ── Visual helpers ───────────────────────────────────────────────

const AGENT_COLOR: Record<string, string> = {
  target: "#38bdf8",
  gatekeeper: "#22d3ee",
  bastion: "#a855f7",
  warden: "#ef4444",
  auditor: "#f59e0b",
  memory: "#ec4899",
  reasoner: "#a855f7",
};

function severityColor(sev: string | null | undefined): string {
  if (sev === "CRITICAL") return "#ef4444";
  if (sev === "WARN") return "#f59e0b";
  return "#22c55e";
}

function edgeAnchors(from: FlowNode, to: FlowNode) {
  const x1 = from.x + NODE_W, y1 = from.y + NODE_H / 2;
  const x2 = to.x, y2 = to.y + NODE_H / 2;
  const dx = Math.max(40, (x2 - x1) / 2);
  return { p0: { x: x1, y: y1 }, p1: { x: x1 + dx, y: y1 }, p2: { x: x2 - dx, y: y2 }, p3: { x: x2, y: y2 } };
}
function edgePath(from: FlowNode, to: FlowNode): string {
  const { p0, p1, p2, p3 } = edgeAnchors(from, to);
  return `M ${p0.x} ${p0.y} C ${p1.x} ${p1.y}, ${p2.x} ${p2.y}, ${p3.x} ${p3.y}`;
}
function pointOnEdge(from: FlowNode, to: FlowNode, t: number) {
  const { p0, p1, p2, p3 } = edgeAnchors(from, to);
  const u = 1 - t;
  return {
    x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
    y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
  };
}

function timeAgo(ts: string): string {
  const s = Math.max(0, Math.floor((Date.now() - new Date(ts).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

function timeLeft(expires: string): string {
  const s = Math.max(0, Math.floor((new Date(expires).getTime() - Date.now()) / 1000));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  if (m >= 60) return `${Math.floor(m / 60)}h ${m % 60}m`;
  return `${m}m ${sec.toString().padStart(2, "0")}s`;
}

// ── Flow canvas — driven by the active stage (null = resting) ─────

function FlowCanvas({
  activeStage, severity,
}: { activeStage: number | null; severity: string }) {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (activeStage === null) { setProgress(0); return; }
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / STAGE_MS);
      setProgress(p);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [activeStage]);

  const isProcessing = (id: NodeId): boolean => {
    const s = NODE_STAGE[id];
    if (s === undefined) return false;
    return s === activeStage;
  };

  return (
    <div className="flex-1 min-w-0 rounded-2xl border border-white/10 bg-[#0c0e14] overflow-auto relative">
      <div className="absolute top-3 left-4 text-xs uppercase tracking-wider text-white/30 z-10">
        Perimeter Pipeline
      </div>
      <div className="relative mx-auto" style={{ width: CANVAS_W, height: CANVAS_H }}>
        <svg className="absolute inset-0" width={CANVAS_W} height={CANVAS_H} style={{ pointerEvents: "none" }}>
          <defs>
            <marker id="arrow-b" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
              <path d="M0,0 L6,3 L0,6 Z" fill="#475569" />
            </marker>
          </defs>

          {EDGES.map(([from, to]) => {
            const stage = EDGE_STAGE[`${from}>${to}`];
            const traversing = stage === activeStage;
            return (
              <path
                key={`${from}-${to}`}
                d={edgePath(nodeById(from), nodeById(to))}
                fill="none"
                stroke={traversing ? AGENT_COLOR[to] : "#2a3344"}
                strokeWidth={traversing ? 2.5 : 1.5}
                markerEnd="url(#arrow-b)"
                opacity={traversing ? 0.95 : 0.5}
              />
            );
          })}

          {EDGES.map(([from, to]) => {
            const stage = EDGE_STAGE[`${from}>${to}`];
            if (stage !== activeStage) return null;
            const pt = pointOnEdge(nodeById(from), nodeById(to), progress);
            const color = AGENT_COLOR[to];
            return (
              <g key={`pulse-${from}-${to}`}>
                <circle cx={pt.x} cy={pt.y} r={9} fill={color} opacity={0.25} />
                <circle cx={pt.x} cy={pt.y} r={4.5} fill={color} />
              </g>
            );
          })}
        </svg>

        {NODES.map((n) => {
          const Icon = n.icon;
          const on = isProcessing(n.id);
          const color = AGENT_COLOR[n.id];
          // Warden always reads "danger" red when active (it's a block); others
          // go red only on a CRITICAL incident.
          const crit = on && n.id !== "target" && (n.id === "warden" || severity === "CRITICAL");
          const glow = crit ? "#ef4444" : color;
          return (
            <div
              key={n.id}
              className="absolute rounded-xl border bg-[#11141d] transition-all duration-200"
              style={{
                left: n.x, top: n.y, width: NODE_W, height: NODE_H,
                borderColor: on ? glow : "rgba(255,255,255,0.08)",
                boxShadow: on ? `0 0 0 1px ${glow}66, 0 0 26px ${glow}55` : "none",
                transform: on ? "scale(1.04)" : "scale(1)",
              }}
            >
              <div className="flex items-center gap-3 h-full px-3">
                <div
                  className="shrink-0 w-10 h-10 rounded-lg flex items-center justify-center transition-colors"
                  style={{ background: on ? `${glow}26` : `${color}12`, color: on ? glow : color }}
                >
                  <Icon className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-semibold text-white truncate">{n.label}</span>
                    {on && <CircleDot className="w-3 h-3 shrink-0 animate-pulse" style={{ color: glow }} />}
                  </div>
                  <div className="text-[11px] text-white/40 truncate">
                    {on ? "processing…" : n.sub}
                  </div>
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
  );
}

// ── Page ─────────────────────────────────────────────────────────

export default function PerimeterOpsPage() {
  const [state, setState] = useState<BastionState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeStage, setActiveStage] = useState<number | null>(null);
  const [, force] = useState(0); // tick to refresh countdowns between polls

  const lastTsRef = useRef<string | null>(null);
  const lastAuditRef = useRef<number | null>(null);
  const lastBlockCountRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const playSequence = useCallback((stages: number[]) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    let i = 0;
    const advance = () => {
      if (i >= stages.length) { setActiveStage(null); timerRef.current = null; return; }
      setActiveStage(stages[i]);
      i += 1;
      timerRef.current = setTimeout(advance, STAGE_MS);
    };
    advance();
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/bastion/state", { cache: "no-store" });
      const json = await res.json();
      if (json.error) { setError(json.error); return; }
      const data = json.data as BastionState;
      setState(data);
      setError(null);

      const newTs = data.lastEventTs ?? null;
      const newAuditId = data.audit?.[0]?.id ?? null;
      const newBlockCount = data.activeBlocks.length;
      const auditChanged =
        lastAuditRef.current !== null && newAuditId !== null && newAuditId !== lastAuditRef.current;
      const pollChanged =
        lastTsRef.current !== null && newTs !== null && newTs !== lastTsRef.current;
      const blockChanged =
        lastBlockCountRef.current !== null && newBlockCount !== lastBlockCountRef.current;
      if (auditChanged || pollChanged || blockChanged) playSequence([0, 1, 2]);
      lastTsRef.current = newTs;
      lastAuditRef.current = newAuditId;
      lastBlockCountRef.current = newBlockCount;
    } catch {
      setError("Failed to reach the Bastion API");
    }
  }, [playSequence]);

  useEffect(() => {
    load();
    const t = setInterval(load, 2500);
    const c = setInterval(() => force((n) => n + 1), 1000); // live countdowns
    return () => {
      clearInterval(t);
      clearInterval(c);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [load]);

  const incident = state?.incidentActive ?? false;
  const topSev = state?.audit?.[0]?.severity ?? (incident ? "WARN" : "NORMAL");
  const blocks = state?.activeBlocks ?? [];

  return (
    <AppPageShell>
      <PageHeader
        title="Perimeter Ops"
        subtitle="Live SSH brute-force guard — who is knocking, and who got blocked"
        icon={ShieldCheck}
        color="purple"
        status={incident ? "warning" : "online"}
      />

      {/* Status strip */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
        <StatCard label="Target" value={state?.target ?? "space-armour-server"} mono />
        <StatCard
          label="Status"
          value={blocks.length > 0 ? "BLOCKING" : incident ? "ELEVATED" : "NOMINAL"}
          color={blocks.length > 0 ? "#ef4444" : incident ? "#f59e0b" : "#22c55e"}
          pulse={incident}
        />
        <StatCard label={`Attempts / ${state?.windowSeconds ?? 60}s`} value={`${state?.attemptsLastMinute ?? 0}`} color={incident ? "#f59e0b" : undefined} />
        <StatCard label="Watched IPs" value={`${state?.watched.length ?? 0}`} />
        <StatCard label="Active blocks" value={`${blocks.length}`} color={blocks.length > 0 ? "#ef4444" : undefined} pulse={blocks.length > 0} />
      </div>

      <div className="flex flex-col xl:flex-row gap-4">
        <FlowCanvas activeStage={activeStage} severity={topSev} />

        {/* Activity feed */}
        <div className="xl:w-[360px] shrink-0 rounded-2xl border border-white/10 bg-[#0c0e14] flex flex-col max-h-[520px]">
          <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between">
            <span className="text-xs uppercase tracking-wider text-white/40">Live Activity</span>
            {incident ? (
              <span className="inline-flex items-center gap-1 text-[11px] text-red-400">
                <AlertTriangle className="w-3 h-3" /> {blocks.length > 0 ? "blocking" : "elevated"}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-[11px] text-green-400">
                <CircleDot className="w-3 h-3" /> guarding
              </span>
            )}
          </div>
          <div className="flex-1 overflow-auto p-2 space-y-1">
            {error && <div className="text-xs text-red-400 p-2">{error}</div>}
            {state && state.activity.length === 0 && (
              <div className="text-xs text-white/30 p-2">Waiting for SSH activity…</div>
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

      {/* Active blocks table */}
      <div className="mt-4 rounded-2xl border border-white/10 bg-[#0c0e14]">
        <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between">
          <span className="text-xs uppercase tracking-wider text-white/40">
            Active Blocks {blocks.length > 0 && <span className="text-red-400">· {blocks.length}</span>}
          </span>
          <span className="text-[10px] text-white/30">ipset timeout — auto-released at expiry</span>
        </div>
        {blocks.length === 0 ? (
          <div className="px-4 py-6 text-xs text-white/30">No IPs are currently blocked.</div>
        ) : (
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-white/35 text-left">
                  <th className="px-4 py-2 font-medium">Source IP</th>
                  <th className="px-4 py-2 font-medium">Attempts</th>
                  <th className="px-4 py-2 font-medium">Blocked</th>
                  <th className="px-4 py-2 font-medium">Time remaining</th>
                  <th className="px-4 py-2 font-medium">Reason</th>
                </tr>
              </thead>
              <tbody>
                {blocks.map((b) => (
                  <tr key={b.id} className="border-t border-white/5">
                    <td className="px-4 py-2 font-mono text-red-300">{b.src_ip}</td>
                    <td className="px-4 py-2 text-white/70">{b.attempt_count ?? "—"}</td>
                    <td className="px-4 py-2 text-white/50">{timeAgo(b.blocked_at)}</td>
                    <td className="px-4 py-2 font-mono text-amber-300">{timeLeft(b.expires_at)}</td>
                    <td className="px-4 py-2 text-white/60 max-w-[360px] truncate">{b.reason ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Latest decision */}
      {state?.audit?.[0] && (
        <div className="mt-4 rounded-2xl border border-white/10 bg-[#0c0e14] p-4">
          <div className="text-xs uppercase tracking-wider text-white/40 mb-2">
            Latest decision — {timeAgo(state.audit[0].ts)}
          </div>
          <div className="flex flex-wrap items-center gap-2 mb-2 text-xs">
            <Badge color={severityColor(state.audit[0].severity)}>{state.audit[0].severity}</Badge>
            <span className="text-white/50">source:</span>
            <span className="font-mono text-white/80">{state.audit[0].src_ip}</span>
            <span className="text-white/50">·</span>
            <span className="font-mono text-white/80">
              {state.audit[0].attempt_count} attempts / {state.audit[0].window_seconds}s
            </span>
            <span className="text-white/50">· SOP:</span>
            <span className="font-mono text-white/80">{state.audit[0].sop_ref}</span>
            <span className="text-white/50">· confidence:</span>
            <span className="font-mono text-white/80">{state.audit[0].confidence ?? "—"}</span>
          </div>
          <p className="text-sm text-white/70 leading-relaxed">{state.audit[0].reasoning}</p>
          {state.audit[0].action_taken && (
            <p className="mt-2 text-[11px] font-mono text-white/40">{state.audit[0].action_taken}</p>
          )}
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
