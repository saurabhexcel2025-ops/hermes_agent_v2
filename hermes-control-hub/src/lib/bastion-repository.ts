// ═══════════════════════════════════════════════════════════════
// bastion-repository.ts — reads the Bastion SSH-guard state from Postgres
// (hermes_auth) for the live Perimeter Ops page. Fully separate from Sentinel.
// ═══════════════════════════════════════════════════════════════

import { pgPool } from "@/lib/pg";

export interface WatchedIp {
  src_ip: string;
  attempts: number;
  last_ts: string;
  blocked: boolean;
}

export interface ActiveBlock {
  id: number;
  src_ip: string;
  target: string | null;
  blocked_at: string;
  expires_at: string;
  attempt_count: number | null;
  reason: string | null;
}

export interface SshAuditEntry {
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

export interface BastionState {
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
}

const WINDOW_SECONDS = 60;
const ATTEMPT_THRESHOLD = 5;

async function bastionTablesExist(): Promise<boolean> {
  const { rows } = await pgPool.query(
    `SELECT to_regclass('public.ssh_events') IS NOT NULL AS ok`,
  );
  return Boolean(rows[0]?.ok);
}

export async function getBastionState(): Promise<BastionState> {
  const base: BastionState = {
    ready: false, target: null, windowSeconds: WINDOW_SECONDS,
    attemptThreshold: ATTEMPT_THRESHOLD, attemptsLastMinute: 0,
    watched: [], activeBlocks: [], audit: [], lastEventTs: null,
    incidentActive: false,
  };
  if (!(await bastionTablesExist())) return base;

  const [watchedRes, blocksRes, auditRes, totalRes, lastRes] = await Promise.all([
    // Per-IP attempt counts in the trailing window, busiest first, flagged if
    // currently under an active block.
    pgPool.query(
      `SELECT e.src_ip,
              COUNT(*)::int AS attempts,
              MAX(e.event_ts) AS last_ts,
              EXISTS (
                SELECT 1 FROM ssh_blocks b
                WHERE b.src_ip = e.src_ip AND b.released_at IS NULL
                  AND b.expires_at > now()
              ) AS blocked
       FROM ssh_events e
       WHERE e.event_ts > now() - ($1 || ' seconds')::interval
       GROUP BY e.src_ip
       ORDER BY attempts DESC
       LIMIT 12`,
      [WINDOW_SECONDS],
    ),
    pgPool.query(
      `SELECT id, src_ip, target, blocked_at, expires_at, attempt_count, reason
       FROM ssh_blocks
       WHERE released_at IS NULL AND expires_at > now()
       ORDER BY blocked_at DESC
       LIMIT 50`,
    ),
    pgPool.query(
      `SELECT id, ts, target, src_ip, attempt_count, window_seconds, severity,
              sop_ref, reasoning, confidence, action_taken
       FROM ssh_audit_log ORDER BY id DESC LIMIT 12`,
    ),
    pgPool.query(
      `SELECT COUNT(*)::int AS n FROM ssh_events
       WHERE event_ts > now() - ($1 || ' seconds')::interval`,
      [WINDOW_SECONDS],
    ),
    pgPool.query(`SELECT MAX(event_ts) AS ts FROM ssh_events`),
  ]);

  const watched: WatchedIp[] = watchedRes.rows;
  const activeBlocks: ActiveBlock[] = blocksRes.rows;
  const audit: SshAuditEntry[] = auditRes.rows;
  const attemptsLastMinute = totalRes.rows[0]?.n ?? 0;
  const lastEventTs = lastRes.rows[0]?.ts ?? null;

  const target =
    activeBlocks[0]?.target ?? audit[0]?.target ??
    (watched.length ? null : null);

  // Incident is "active" if anything is currently blocked, an IP is over the
  // threshold right now, or the newest audit row was sealed within 60s.
  const now = Date.now();
  const auditFresh =
    audit.length > 0 && now - new Date(audit[0].ts).getTime() < 60_000;
  const overThreshold = watched.some((w) => w.attempts > ATTEMPT_THRESHOLD);
  const incidentActive = activeBlocks.length > 0 || overThreshold || auditFresh;

  return {
    ready: true, target, windowSeconds: WINDOW_SECONDS,
    attemptThreshold: ATTEMPT_THRESHOLD, attemptsLastMinute,
    watched, activeBlocks, audit, lastEventTs, incidentActive,
  };
}
