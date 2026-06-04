-- ============================================================
-- Sentinel — Autonomous Ops schema (applied to hermes_auth)
-- Run once:  psql "$DATABASE_URL" -f sentinel/schema.sql
-- ============================================================

CREATE EXTENSION IF NOT EXISTS vector;

-- ── Live telemetry (satellite naming), one row per 10s poll ──
CREATE TABLE IF NOT EXISTS telemetry (
  id              BIGSERIAL PRIMARY KEY,
  ts              TIMESTAMPTZ NOT NULL DEFAULT now(),
  target          TEXT,        -- which target server this came from
  processor_load  REAL,        -- CPU %            (satellite: processor load)
  ram_saturation  REAL,        -- Memory %         (satellite: RAM bus saturation)
  storage_write   REAL,        -- Disk write KB/s  (satellite: storage write rate)
  downlink        REAL,        -- Net in KB/s      (satellite: downlink throughput)
  uplink          REAL,        -- Net out KB/s     (satellite: uplink throughput)
  active_subsys   INTEGER,     -- Process count    (satellite: active subsystems)
  top_proc        TEXT,        -- highest-CPU process name
  top_pid         INTEGER,     -- its PID
  top_cpu         REAL,        -- its CPU %
  severity        TEXT NOT NULL DEFAULT 'NORMAL'  -- NORMAL | WARN | CRITICAL
);
CREATE INDEX IF NOT EXISTS idx_telemetry_ts ON telemetry (ts DESC);

-- ── Immutable audit trail (detect-and-log only, no remediation) ──
CREATE TABLE IF NOT EXISTS audit_log (
  id            BIGSERIAL PRIMARY KEY,
  ts            TIMESTAMPTZ NOT NULL DEFAULT now(),
  target        TEXT,        -- which target server
  anomaly       TEXT,        -- what was detected
  severity      TEXT,
  culprit_proc  TEXT,        -- offending process name
  culprit_pid   INTEGER,     -- offending process PID
  culprit_cpu   REAL,        -- its CPU %
  sop_ref       TEXT,        -- SOP id/title used for context
  reasoning     TEXT,        -- glm-5 plain-English summary
  confidence    REAL,        -- 0..1
  telemetry_id  BIGINT REFERENCES telemetry(id)
);
CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_log (ts DESC);

-- ── SOP knowledge base — pgvector (replaces ChromaDB) ──
-- 768 dims = nomic-embed-text via Ollama Cloud (same provider as the LLM).
CREATE TABLE IF NOT EXISTS sops (
  id         TEXT PRIMARY KEY,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL,
  embedding  vector(768)
);
