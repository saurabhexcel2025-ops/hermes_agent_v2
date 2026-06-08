-- ============================================================
-- Bastion — SSH brute-force guard schema (applied to hermes_auth)
-- Fully separate from Sentinel; watches the same target server.
-- Run once:  psql "$DATABASE_URL" -f bastion/schema.sql
-- ============================================================

CREATE EXTENSION IF NOT EXISTS vector;

-- ── Raw SSH attempts — one row per sshd auth/connection log line ──
-- event_ts comes from the log when parseable (journalctl), else ingest time.
-- raw_hash makes ingestion idempotent across overlapping poll windows.
CREATE TABLE IF NOT EXISTS ssh_events (
  id           BIGSERIAL PRIMARY KEY,
  event_ts     TIMESTAMPTZ NOT NULL DEFAULT now(),
  ingested_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  target       TEXT,
  src_ip       TEXT NOT NULL,
  username     TEXT,
  result       TEXT,        -- accepted | failed | invalid | preauth
  raw          TEXT,
  raw_hash     TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ssh_events_hash ON ssh_events (raw_hash);
CREATE INDEX IF NOT EXISTS idx_ssh_events_ts  ON ssh_events (event_ts DESC);
CREATE INDEX IF NOT EXISTS idx_ssh_events_ip  ON ssh_events (src_ip);

-- ── Active / historical blocks (the enforcement record) ──────────
-- ipset owns the real expiry (timeout, 5m); this table mirrors it so the
-- dashboard can show a countdown, the cycle can avoid re-blocking, and the
-- sweeper can find expired blocks to remove the (TTL-less) VPC firewall rule.
CREATE TABLE IF NOT EXISTS ssh_blocks (
  id             BIGSERIAL PRIMARY KEY,
  src_ip         TEXT NOT NULL,
  target         TEXT,
  blocked_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at     TIMESTAMPTZ NOT NULL,
  released_at    TIMESTAMPTZ,           -- set if lifted early
  attempt_count  INTEGER,               -- attempts in the trigger window
  reason         TEXT,
  audit_id       BIGINT
);
CREATE INDEX IF NOT EXISTS idx_ssh_blocks_active ON ssh_blocks (src_ip, expires_at DESC);

-- ── Immutable audit trail — one row per detection+block decision ──
CREATE TABLE IF NOT EXISTS ssh_audit_log (
  id             BIGSERIAL PRIMARY KEY,
  ts             TIMESTAMPTZ NOT NULL DEFAULT now(),
  target         TEXT,
  src_ip         TEXT,
  attempt_count  INTEGER,       -- attempts seen in the window
  window_seconds INTEGER,
  severity       TEXT,          -- WARN | CRITICAL
  sop_ref        TEXT,          -- SOP id/title used for context
  reasoning      TEXT,          -- glm-5 plain-English summary
  confidence     REAL,          -- 0..1
  action_taken   TEXT           -- e.g. "ipset add bastion_block <ip> timeout 300 | vpc DENY ..."
);
CREATE INDEX IF NOT EXISTS idx_ssh_audit_ts ON ssh_audit_log (ts DESC);

-- ── Bastion's OWN SOP knowledge base — pgvector (separate from Sentinel) ──
-- 384 dims = multi-qa-MiniLM-L6-cos-v1, the same local embedder mem0 uses.
CREATE TABLE IF NOT EXISTS bastion_sops (
  id         TEXT PRIMARY KEY,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL,
  embedding  vector(384)
);
