// ═══════════════════════════════════════════════════════════════
// sentinel-repository.ts — reads the Sentinel telemetry + audit trail
// from Postgres (hermes_auth) for the live Ops flow page.
// ═══════════════════════════════════════════════════════════════

import { pgPool } from "@/lib/pg";

export interface TelemetrySample {
  ts: string;
  target: string | null;
  processor_load: number | null;
  ram_saturation: number | null;
  storage_write: number | null;
  downlink: number | null;
  uplink: number | null;
  active_subsys: number | null;
  top_proc: string | null;
  top_pid: number | null;
  top_cpu: number | null;
  severity: string;
}

export interface AuditEntry {
  id: number;
  ts: string;
  target: string | null;
  anomaly: string | null;
  severity: string | null;
  culprit_proc: string | null;
  culprit_pid: number | null;
  culprit_cpu: number | null;
  sop_ref: string | null;
  reasoning: string | null;
  confidence: number | null;
}

/** Has the Sentinel schema been created yet? */
async function sentinelTablesExist(): Promise<boolean> {
  const { rows } = await pgPool.query(
    `SELECT to_regclass('public.telemetry') IS NOT NULL AS ok`,
  );
  return Boolean(rows[0]?.ok);
}

export async function getLatestTelemetry(): Promise<TelemetrySample | null> {
  const { rows } = await pgPool.query<TelemetrySample>(
    `SELECT ts, target, processor_load, ram_saturation, storage_write, downlink,
            uplink, active_subsys, top_proc, top_pid, top_cpu, severity
     FROM telemetry ORDER BY id DESC LIMIT 1`,
  );
  return rows[0] ?? null;
}

export async function getTelemetryHistory(limit = 40): Promise<TelemetrySample[]> {
  const { rows } = await pgPool.query<TelemetrySample>(
    `SELECT ts, target, processor_load, ram_saturation, storage_write, downlink,
            uplink, active_subsys, top_proc, top_pid, top_cpu, severity
     FROM telemetry ORDER BY id DESC LIMIT $1`,
    [limit],
  );
  return rows.reverse(); // chronological for sparklines
}

export async function getRecentAudit(limit = 12): Promise<AuditEntry[]> {
  const { rows } = await pgPool.query<AuditEntry>(
    `SELECT id, ts, target, anomaly, severity, culprit_proc, culprit_pid,
            culprit_cpu, sop_ref, reasoning, confidence
     FROM audit_log ORDER BY id DESC LIMIT $1`,
    [limit],
  );
  return rows;
}

export interface SentinelState {
  ready: boolean;
  target: string | null;
  latest: TelemetrySample | null;
  history: TelemetrySample[];
  audit: AuditEntry[];
  incidentActive: boolean;
}

export async function getSentinelState(): Promise<SentinelState> {
  if (!(await sentinelTablesExist())) {
    return { ready: false, target: null, latest: null, history: [], audit: [], incidentActive: false };
  }
  const [latest, history, audit] = await Promise.all([
    getLatestTelemetry(),
    getTelemetryHistory(40),
    getRecentAudit(12),
  ]);

  // An incident is "active" if the latest sample is non-normal, or the most
  // recent audit entry was written within the last 60s.
  const now = Date.now();
  const auditFresh =
    audit.length > 0 && now - new Date(audit[0].ts).getTime() < 60_000;
  const incidentActive = (latest?.severity ?? "NORMAL") !== "NORMAL" || auditFresh;

  return {
    ready: true,
    target: latest?.target ?? null,
    latest,
    history,
    audit,
    incidentActive,
  };
}
