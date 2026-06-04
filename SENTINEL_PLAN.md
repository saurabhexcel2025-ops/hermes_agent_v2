# Sentinel — Autonomous Ops Agent · Build Plan

Concrete, file-by-file plan to build the **Space Armour Autonomous Ops Demo**
on top of the existing Hermes + mem0 + Postgres + Control Hub stack.

## Locked decisions

| Topic | Decision |
|---|---|
| **Model** | `glm-5` via Ollama Cloud (already the default in `.hermes/config.yaml`) |
| **Memory** | **Both** mem0 **and** Hindsight — mem0 for fast cross-cycle operational memory, Hindsight for the incident knowledge graph. Dashboard already has tabs for both. |
| **SOP vector store** | **pgvector** (we already run it) — NOT ChromaDB (doc's Chroma is dropped) |
| **Observability** | Control Hub Logs page + gateway logs + mem0/hindsight tabs — NOT OpenLIT (dropped) |
| **Agents** | A themed **crew of Hermes profiles**, so Mission Control shows a clean roster |
| **Scope** | **Monitor-and-log only.** Sentinel watches a **separate target server** (provided), detects the process spiking the CPU, identifies it, and logs it to the audit trail. **No remediation / no killing.** |
| **Target** | A **remote server** Space Armour provides — NOT the box Sentinel runs on. Telemetry is pulled from that remote host. |

## What we are NOT using (from the doc)

- **ChromaDB** → replaced by pgvector (`sops` table in `hermes_auth`).
- **OpenLIT** → replaced by existing Control Hub logs + memory tabs.

---

## 1. The profile crew (Mission Control roster)

Four Hermes profiles under `.hermes/profiles/`. Each gets `SOUL.md`,
`AGENTS.md`, and a `config.yaml` pinning its memory provider. This is what makes
the dashboard "Agents" roster look like a real ops team.

| Profile | Role | Memory provider | Runs |
|---|---|---|---|
| **sentinel** | Primary actor — detect → reason → act → audit | **mem0** | the live cycle |
| **watchtower** | Telemetry monitoring + threshold classification | **mem0** | continuous poll |
| **archivist** | SOP knowledge base + incident history retrieval | **Hindsight** | on demand |
| **auditor** | Audit-trail integrity + post-incident reporting | **Hindsight** | on demand |

> sentinel/watchtower → **mem0** (operational recall across cycles).
> archivist/auditor → **Hindsight** (knowledge graph of incidents & SOP links).
> Both stores are visible in the Control Hub memory page tabs.

Each `profiles/<name>/config.yaml` sets:
```yaml
memory:
  provider: mem0        # or: hindsight
agent:
  personality: technical
  max_turns: 30
```

---

## 2. Data model (Postgres `hermes_auth`)

New file: `sentinel/schema.sql` — applied once into `hermes_postgres`.

```sql
-- Live telemetry (satellite naming), written every 10s by the collector
CREATE TABLE IF NOT EXISTS telemetry (
  id              BIGSERIAL PRIMARY KEY,
  ts              TIMESTAMPTZ NOT NULL DEFAULT now(),
  processor_load  REAL,    -- CPU %
  ram_saturation  REAL,    -- Memory %
  storage_write   REAL,    -- Disk write rate
  downlink        REAL,    -- Net in
  uplink          REAL,    -- Net out
  active_subsys   INTEGER, -- Process count
  severity        TEXT     -- NORMAL | WARN | CRITICAL
);
CREATE INDEX IF NOT EXISTS idx_telemetry_ts ON telemetry (ts DESC);

-- Immutable audit trail, one row per Sentinel cycle (detect-and-log only)
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

-- SOP knowledge base — pgvector (replaces ChromaDB)
CREATE EXTENSION IF NOT EXISTS vector;
CREATE TABLE IF NOT EXISTS sops (
  id         TEXT PRIMARY KEY,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL,
  embedding  vector(768)     -- nomic-embed-text dims
);
```

---

## 3. New code (repo additions)

```
sentinel/
  schema.sql              # tables above
  collector.py            # 10s poll → telemetry table + severity flag (psutil)
  thresholds.py           # CPU>90 CRITICAL, >70 WARN, etc. (single source of truth)
  sop/                    # SOP source documents (markdown)
    cpu-overload.md
    memory-pressure.md
    storage-saturation.md
    comms-degradation.md
  ingest_sops.py          # embed sop/*.md via Ollama nomic-embed-text → sops table
  sentinel_cycle.py       # the actor: anomaly → SOP → gateway(glm-5) → act → audit → hindsight
  systemd/
    sentinel-collector.service   # runs collector.py as a daemon
    sentinel-cycle.service       # runs sentinel_cycle.py supervisor
```

### 3a. `collector.py` (Watchtower's job)
- Every 10s: `psutil` → CPU%, mem%, disk write rate, net in/out, process count.
- Map to satellite columns, classify severity via `thresholds.py`, INSERT into `telemetry`.
- Connects to Postgres on `127.0.0.1:5432` (`hermes_auth`, `${POSTGRES_PASSWORD}`).

### 3b. `ingest_sops.py` (Archivist's knowledge base)
- Read `sop/*.md`, embed each with Ollama `nomic-embed-text` (the embedder we
  already run), upsert into `sops` with its 768-dim vector.
- Run once at setup and whenever SOPs change.

### 3c. `sentinel_cycle.py` (Sentinel — the actor)
**Detect-and-log only — no remediation.** The loop:
1. Read the latest `telemetry` row from the **target server**; if
   `severity != NORMAL`, an anomaly is open.
2. **Identify the culprit** — pull the **top CPU process** on the target server
   (name, PID, CPU%, user) from the same telemetry feed.
3. **SOP retrieval** — embed the anomaly description, `ORDER BY embedding <=> $1`
   over `sops` (pgvector cosine), take the top matching SOP (gives the log
   context/explanation).
4. **Reasoning** — call the **Hermes gateway** (`http://localhost:8642`,
   `Bearer $HERMES_GATEWAY_API_KEY`) with **profile `sentinel`** and `glm-5`,
   passing telemetry snapshot + anomaly + offending process + SOP text. Ask for
   strict JSON: `{summary, culprit_process, sop_ref, confidence}`.
   - Using the gateway+profile means the cycle shows up as a **session** in the
     dashboard and uses the profile's **mem0** memory automatically.
5. **Log** — INSERT a sealed row into `audit_log` (what spiked, which process,
   the explanation). **No command is executed.**
6. **Memory (both)**:
   - mem0 is updated automatically by the sentinel profile's provider.
   - Also POST an incident record to **Hindsight** (`localhost:9177`, bank
     `hermes`) so the knowledge graph links target ↔ anomaly ↔ culprit process.

> The 10s cadence is a daemon loop (systemd), not minute-granularity cron.
> Collector writes every 10s; the cycle reacts the moment severity ≠ NORMAL,
> giving the doc's "30–60s trigger-to-resolved" timing.

---

## 4. Memory wiring (mem0 + Hindsight, both live)

- **mem0** — already running (`hermes_mem0`, `:8888`). Active provider for
  `sentinel`/`watchtower`. No new infra.
- **Hindsight** — start the local Hindsight HTTP server on `:9177` (the Control
  Hub `/api/memory/hindsight` route already targets `host.docker.internal:9177`).
  Add to `.hermes/.env`:
  ```
  HINDSIGHT_MODE=local
  HINDSIGHT_BANK_ID=hermes
  HINDSIGHT_BASE_URL=http://localhost:9177
  ```
  Set `memory.provider: hindsight` in the `archivist`/`auditor` profile configs.
- Both appear in the Control Hub **Memory** page (mem0 tab + Hindsight tab — both
  routes already exist).

---

## 5. Mission Control dashboard (Control Hub additions)

Postgres-backed, read-only panels (Control Hub already has a `pg` pool on
`hermes_auth`).

| File | Purpose |
|---|---|
| `src/lib/sentinel-repository.ts` | `getLatestTelemetry()`, `getTelemetryHistory()`, `getAuditLog()` via `pg` |
| `src/app/api/sentinel/telemetry/route.ts` | live telemetry JSON (polled by UI) |
| `src/app/api/sentinel/audit/route.ts` | audit-trail JSON |
| `src/app/(main)/ops/page.tsx` | **Ops** page: live telemetry panels (satellite labels) + current anomaly/reasoning + audit log feed |

Panels:
1. **Telemetry** — live gauges for processor load, RAM saturation, storage
   write, downlink/uplink, active subsystems (poll `/api/sentinel/telemetry` ~2s).
2. **Active Reasoning** — current anomaly, the SOP referenced, glm-5 summary,
   recommended action, confidence.
3. **Audit Trail** — reverse-chronological sealed entries from `audit_log`.

No new DB engine — reuses the existing Postgres pool.

---

## 6. Build phases

**Phase 1 — Data + telemetry — ✅ built**
- `sentinel/schema.sql`, `probe.py` (SSH + local fallback), `collector.py`,
  `thresholds.py`, `db.py`. Daemons run inside `mem0-server` via `supervisor.sh`.

**Phase 2 — SOP knowledge base — ✅ built**
- `sop/*.md` (CPU, memory, storage, comms), `ingest_sops.py`, `embeddings.py`
  (**Ollama Cloud `nomic-embed-text`, 768 dims** — same provider as the LLM).

**Phase 3 — Profiles — ✅ built**
- `sentinel`, `watchtower` (mem0); `archivist`, `auditor` (hindsight). Each has
  SOUL.md / AGENTS.md / config.yaml under `.hermes/profiles/`.

**Phase 5 — The cycle — ✅ built**
- `sentinel_cycle.py`: anomaly → SOP (pgvector) → gateway(glm-5) → `audit_log`
  → Hindsight retain. Detect-and-log only.

**Phase 4 — Hindsight — ⏳ to do (deploy step)**
- Start the Hindsight local server (`:9177`) on the host; add `HINDSIGHT_*` to
  `.hermes/.env`; verify `/api/memory/hindsight` returns data. The cycle already
  posts to it (best-effort).

**Phase 6 — Dashboard — ⏳ to do (next coding phase)**
- Control Hub: `sentinel-repository.ts`, `/api/sentinel/telemetry`,
  `/api/sentinel/audit`, and the Ops page with the three panels.

**Phase 7 — Demo runbook — ✅ documented** (`sentinel/README.md`)
- On the target: `stress-ng --cpu N` → telemetry spike → detect → reason →
  audit entry, ~30–60s.

### What's left before a live demo
1. Provide the **target server** + SSH key (`sentinel/id_target`) and set the
   `SENTINEL_TARGET_*` env.
2. Apply schema, rebuild `mem0-server`, run `ingest_sops.py` (see
   `sentinel/README.md`).
3. Stand up **Hindsight** on `:9177` (Phase 4).
4. Build the **Ops dashboard page** (Phase 6).

---

## 7. Demo trigger (runbook)

```bash
# On the GCP VM:
ssh etech@34.61.120.188
stress-ng --cpu 4 --timeout 30s      # or: yes > /dev/null &
```
Within ~10s: telemetry panel spikes → `watchtower`/`collector` flags CRITICAL →
`sentinel` retrieves the CPU SOP → glm-5 reasons → Sentinel executes the
remediation command → audit entry appears. Total: ~30–60s.

---

## Open items to confirm before Phase 1

1. **How Sentinel reaches the target server** — the one real open question. The
   target is a separate machine, so the collector needs a way to read its
   CPU + process list. Options:
   - **SSH** — collector SSHs in and runs `top`/`ps` (simplest; just needs an
     SSH key/credentials to the target). **Recommended.**
   - **Metrics agent** — install a small exporter (e.g. node_exporter) on the
     target and scrape it (no per-process names without extra setup).
   - **Tiny agent script** — a small script on the target that POSTs its
     telemetry to us every 10s.
2. **Where the daemons run** — **decided: inside an existing container, no new
   container.** Recommended: the **`mem0-server`** container (it already has
   Python, Postgres access, and Ollama access).
3. **SOP content** — confirm the 4 starter SOPs (CPU, memory, storage, comms) or
   provide your own text. (SOPs now provide log *context/explanation* only,
   since there is no remediation step.)
