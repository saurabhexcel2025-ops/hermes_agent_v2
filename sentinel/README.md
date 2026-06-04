# Sentinel — Autonomous Ops (build)

Detect-and-log autonomous ops agent. Watches a **separate target server** over
SSH, detects CPU/resource spikes, identifies the culprit process, reasons with
**glm-5**, and writes sealed entries to the audit trail. **No remediation.**

Runs inside the existing **`mem0-server`** container (no new container). See
`../SENTINEL_PLAN.md` for the full design.

## Files

| File | Role |
|---|---|
| `schema.sql` | `telemetry`, `audit_log`, `sops` tables (Postgres `hermes_auth`) |
| `probe.py` | SSH (or local) telemetry probe — CPU/mem/disk/net + top process |
| `collector.py` | Watchtower daemon — polls every 10s → `telemetry` |
| `thresholds.py` | Severity rules (CPU>90 CRITICAL, >70 WARN, …) |
| `sop/*.md` | Standard Operating Procedures (knowledge base source) |
| `ingest_sops.py` | Embed SOPs → pgvector `sops` (768-dim) |
| `embeddings.py` | Ollama Cloud embeddings (`nomic-embed-text`) — same provider as the LLM |
| `sentinel_cycle.py` | Sentinel daemon — anomaly → SOP → glm-5 → `audit_log` → Hindsight |
| `supervisor.sh` | Starts both daemons, then execs the mem0 server (container CMD) |
| `db.py` | Postgres connection helper |

## Deploy (on the GCP server)

1. **Set env** in the root `.env` (consumed by docker-compose → mem0-server):
   ```
   SENTINEL_TARGET_HOST=<target server IP>
   SENTINEL_TARGET_USER=<ssh user>
   SENTINEL_SSH_KEY=/data/sentinel/id_target
   ```
   Drop the matching private key at `sentinel/id_target` (chmod 600). It is
   bind-mounted read-only into the container at `/data/sentinel/id_target`.
   `HERMES_GATEWAY_API_KEY` must already be set (shared with the gateway).

2. **Apply the schema** (once):
   ```bash
   docker exec -i hermes_postgres psql -U hermes -d hermes_auth < sentinel/schema.sql
   ```

3. **Rebuild + start mem0-server** (now also runs the Sentinel daemons):
   ```bash
   docker compose up -d --build mem0-server
   docker compose logs -f mem0-server     # watch "sentinel.collector" lines
   ```

4. **Ingest the SOPs** (once, and whenever sop/*.md change):
   ```bash
   docker exec -w /data/sentinel hermes_mem0 python ingest_sops.py
   ```

5. **Verify** telemetry is landing and the audit trail fills on a spike:
   ```bash
   docker exec hermes_postgres psql -U hermes -d hermes_auth \
     -c "SELECT ts,processor_load,severity,top_proc FROM telemetry ORDER BY id DESC LIMIT 5;"
   ```

## Demo

On the target server, spike the CPU:
```bash
stress-ng --cpu 4 --timeout 30s    # or: yes > /dev/null &
```
Within ~10s the collector records a CRITICAL sample; the cycle retrieves the CPU
SOP, glm-5 explains it, and a sealed `audit_log` row appears naming the culprit
process — all visible on the Mission Control Ops page (Phase 6).

## Local testing (no target server)

Leave `SENTINEL_TARGET_HOST` empty → the probe reads the local host. Useful to
verify the pipeline before the real target is wired in.

## Notes

- **Memory:** the `sentinel`/`watchtower` profiles use **mem0**; `archivist`/
  `auditor` use **Hindsight**. The cycle also mirrors each incident into
  Hindsight (best-effort) for the knowledge graph.
- **Dashboard panels** (telemetry / reasoning / audit) are Phase 6 — Control Hub
  additions under `src/app/(main)/ops/` reading these Postgres tables.
