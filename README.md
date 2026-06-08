# Space Armour Automation

A self-hosted AI agent platform with persistent long-term memory, a web-based
Mission Control dashboard, and a fully self-contained memory backend (no managed
memory APIs). Inference is served by **Ollama Cloud**; everything else — vector
storage, the entity graph, the memory API, the control plane, and the reverse
proxy — runs on your own server in Docker.

The production deployment lives on a GCP VM and is fronted by nginx + Let's
Encrypt at two domains:

| URL | App | What it is |
|---|---|---|
| `https://mc.spacearmour.io` | **Control Hub** | Mission Control dashboard (Next.js) — manage profiles, crons, memory |
| `https://mc-hermes.spacearmour.io` | **Hermes Dashboard** | The Hermes agent's built-in web UI (runs on the host, behind Basic Auth) |

---

## Table of Contents

1. [Architecture](#architecture)
2. [Stack](#stack)
3. [Repository Layout](#repository-layout)
4. [Prerequisites](#prerequisites)
5. [Configuration (`.env`)](#configuration-env)
6. [Quick Start (Local / Single Command)](#quick-start)
7. [Full Server Deployment](#full-server-deployment)
   - [1. Clone & configure](#1-clone--configure)
   - [2. TLS bootstrap](#2-tls-bootstrap-one-time)
   - [3. Bring up the Docker stack](#3-bring-up-the-docker-stack)
   - [4. The Hermes agent + gateway (host)](#4-the-hermes-agent--gateway-host)
   - [5. The Hermes dashboard (host, systemd)](#5-the-hermes-dashboard-host-systemd)
8. [Per-Service Reference](#per-service-reference)
9. [Autonomous Agents (Space Armour Ops)](#autonomous-agents-space-armour-ops)
   - [Sentinel — telemetry watchdog](#sentinel--telemetry-watchdog-detect--log)
   - [Bastion — SSH perimeter guard](#bastion--ssh-perimeter-guard-detect--enforce)
   - [Crew profiles](#crew-profiles)
   - [Mission Control Ops pages](#mission-control-ops-pages)
10. [Updating / Redeploying](#updating--redeploying)
11. [Operations & Troubleshooting](#operations--troubleshooting)
12. [Security Notes](#security-notes)

---

## Architecture

```
                              Internet (80/443 only)
                                        │
                          ┌─────────────▼──────────────┐
                          │   nginx  (hermes_nginx)     │  TLS termination, vhosts
                          └───┬──────────────────────┬──┘
            mc.spacearmour.io │                      │ mc-hermes.spacearmour.io
                              │                      │ (Basic Auth)
              ┌───────────────▼────────┐     ┌───────▼──────────────────────┐
              │  Control Hub (Next.js) │     │  Hermes Dashboard (host)     │
              │  hermes_control_hub    │     │  systemd: hermes-dashboard   │
              │  :42069 (internal)     │     │  172.18.0.1:9119             │
              └──────┬─────────────────┘     └──────────────┬───────────────┘
                     │ host.docker.internal:8642            │
                     │                                      │
              ┌──────▼──────────────────────────────────────▼───────┐
              │     Hermes Agent + Gateway (host, launchd/systemd)   │
              │     API server :8642   ·   HERMES_HOME=.hermes       │
              └───────────────────────┬──────────────────────────────┘
                                       │ MEM0_BASE_URL
                          ┌────────────▼─────────────┐
                          │  mem0-server (FastAPI)    │  127.0.0.1:8888
                          │  hermes_mem0              │
                          └───┬───────────────────┬───┘
                              │                   │
                ┌─────────────▼──────┐   ┌────────▼─────────────┐
                │ postgres/pgvector  │   │ neo4j (entity graph) │
                │ 127.0.0.1:5432     │   │ 127.0.0.1:7474/7687  │
                │ vectors + auth DB  │   └──────────────────────┘
                └────────────────────┘

   Inference: all LLM + embedding calls go out to Ollama Cloud (https://ollama.com).
```

**Two memory layers in the agent:**
1. **File memory** (always on) — `MEMORY.md` / `USER.md` per profile, injected into the system prompt.
2. **External provider** (one at a time) — here, **mem0**, which extracts, stores, and semantically retrieves facts via the mem0-server.

---

## Stack

| Layer | Technology |
|---|---|
| **Inference** | Ollama Cloud (`glm-5` default; `kimi-k2.6`, `qwen3.5`) |
| **Agent runtime** | Hermes agent (Python), gateway API on `:8642` |
| **Memory API** | mem0 (`mem0ai`) wrapped in a FastAPI server |
| **Vector store** | PostgreSQL 16 + `pgvector` |
| **Entity graph** | Neo4j 5 (APOC plugin) |
| **Embeddings** | Ollama (`nomic-embed-text`, 768-dim) / sentence-transformers |
| **Control plane** | Next.js (App Router), TypeScript, Radix UI, better-sqlite3, `jose` JWT auth |
| **Reverse proxy / TLS** | nginx + Let's Encrypt (certbot, webroot renewal) |
| **Orchestration** | Docker Compose v2 |

### Docker services (`docker-compose.yml`)

| Container | Image | Bind | Purpose |
|---|---|---|---|
| `hermes_postgres` | `pgvector/pgvector:pg16` | `127.0.0.1:5432` | Auth DB (`hermes_auth`) + mem0 vector storage |
| `hermes_neo4j` | `neo4j:5` | `127.0.0.1:7474/7687` | mem0 entity graph |
| `hermes_mem0` | local build (`./mem0-server`) | `127.0.0.1:8888` | Self-hosted mem0 REST API |
| `hermes_control_hub` | local build (`./hermes-control-hub`) | `expose :42069` (internal) | Mission Control dashboard |
| `hermes_nginx` | `nginx:alpine` | `0.0.0.0:80/443` | Reverse proxy + TLS |

Data services are bound to **loopback only** — only nginx is on the public
interface.

---

## Repository Layout

```
hermes/
├── docker-compose.yml          # All Docker services
├── .env.example                # Copy to .env and fill in
├── nginx/
│   ├── nginx.conf              # Base nginx config (WebSocket map, limits)
│   └── conf.d/
│       ├── mc.spacearmour.io.conf          # Control Hub vhost
│       ├── mc-hermes.spacearmour.io.conf   # Hermes dashboard vhost (Basic Auth)
│       └── .htpasswd                       # Basic Auth users (NOT in git)
├── scripts/
│   └── init-ssl.sh             # One-time Let's Encrypt bootstrap + renewal cron
├── mem0-server/                # Self-hosted mem0 FastAPI server
│   ├── Dockerfile
│   ├── requirements.txt
│   └── server.py
├── hermes-control-hub/         # Next.js Mission Control app
│   ├── Dockerfile
│   ├── docker-entrypoint.sh    # Drops to mount-owner uid (gosu)
│   └── src/
├── sentinel/                   # Sentinel agent (telemetry watchdog) — see sentinel/README.md
├── bastion/                    # Bastion agent (SSH perimeter guard) — see bastion/README.md
└── .hermes/                    # Hermes agent runtime (HERMES_HOME)
    ├── config.yaml             # Model, memory, provider config
    ├── .env                    # Agent API keys, MEM0_BASE_URL, gateway key
    ├── hermes-agent/           # Agent source + venv + web dashboard
    ├── profiles/               # swe, devops, data-scientist, support, creative-lead
    ├── sessions/  logs/  memories/
```

---

## Prerequisites

- **Docker** + **Docker Compose v2**
- **4 GB RAM** minimum (Neo4j + model client overhead)
- Outbound internet (Ollama Cloud API; HuggingFace model pulls on first start)
- A domain with DNS A-records pointed at the server (for TLS)
- An **Ollama Cloud API key** — https://ollama.com/settings
- The **Hermes CLI** installed on the host (the agent + gateway run outside Docker)

---

## Configuration (`.env`)

Copy and fill in the root `.env`:

```bash
cp .env.example .env
```

| Variable | Purpose | How to generate |
|---|---|---|
| `OLLAMA_API_KEY` | Ollama Cloud inference key | from ollama.com/settings |
| `OLLAMA_LLM_MODEL` | Default model (`glm-5`) | — |
| `DOMAIN` | Primary domain (Control Hub) | — |
| `NEXT_PUBLIC_APP_URL` | Public URL of Control Hub | — |
| `JWT_ACCESS_SECRET` | Control Hub access-token signing | `openssl rand -hex 32` |
| `JWT_REFRESH_SECRET` | Control Hub refresh-token signing | `openssl rand -hex 32` |
| `POSTGRES_PASSWORD` | Postgres `hermes` user password | `openssl rand -hex 24` |
| `NEO4J_PASSWORD` | Neo4j `neo4j` user password | `openssl rand -hex 24` |
| `MEM0_USER_ID` | mem0 namespace (`hermes-user`) | — |
| `HERMES_GATEWAY_API_KEY` | Must match `API_SERVER_KEY` in `.hermes/.env` | `openssl rand -hex 32` |

> **Important:** Postgres/Neo4j passwords are only applied on **first** volume
> init. If the data volumes already exist, changing these vars does nothing to
> the live DBs — see [Rotating database passwords](#rotating-database-passwords).

The agent itself reads `.hermes/.env`:

```
OLLAMA_API_KEY=...
API_SERVER_KEY=...            # must equal HERMES_GATEWAY_API_KEY in root .env
MEM0_BASE_URL=http://localhost:8888
MEM0_USER_ID=hermes-user
MEM0_AGENT_ID=hermes
```

---

## Quick Start

For local development on a single machine (no TLS, no domain):

```bash
git clone https://github.com/saurabhexcel2025-ops/hermes_agent_v2.git hermes
cd hermes
cp .env.example .env          # add OLLAMA_API_KEY + generate the secrets
docker compose up --build -d  # brings up postgres, neo4j, mem0, control-hub, nginx
```

mem0-server's first boot pulls models and can take a few minutes (the
healthcheck `start_period` is 300s). Then run the Hermes agent gateway on the
host (see [step 4](#4-the-hermes-agent--gateway-host)).

---

## Full Server Deployment

This is the production flow on the GCP VM (`mission-control-one`,
`us-central1-a`, project `mission-control-497604`).

### 1. Clone & configure

```bash
git clone https://github.com/saurabhexcel2025-ops/hermes_agent_v2.git hermes
cd hermes
cp .env.example .env
# Edit .env: OLLAMA_API_KEY, DOMAIN, NEXT_PUBLIC_APP_URL,
#            JWT_*, POSTGRES_PASSWORD, NEO4J_PASSWORD, HERMES_GATEWAY_API_KEY
```

### 2. TLS bootstrap (one-time)

DNS must already point at the server. The script obtains the Let's Encrypt cert
(standalone), starts the stack, and installs a daily renewal cron.

```bash
bash scripts/init-ssl.sh
```

This handles `mc.spacearmour.io`. For the second domain
(`mc-hermes.spacearmour.io`), issue its cert via the webroot once nginx is up:

```bash
sudo certbot certonly --webroot \
  -w /var/lib/docker/volumes/hermes_certbot_www/_data \
  -d mc-hermes.spacearmour.io
docker exec hermes_nginx nginx -s reload
```

Create the Basic Auth user for the Hermes dashboard vhost:

```bash
htpasswd -c nginx/conf.d/.htpasswd <username>   # then reload nginx
```

### 3. Bring up the Docker stack

```bash
docker compose up -d --build
docker compose ps          # verify all containers healthy
```

### 4. The Hermes agent + gateway (host)

The Hermes agent and its gateway run **outside Docker** so the Control Hub can
reach them via `host.docker.internal:8642`.

```bash
# Install the Hermes CLI, then configure provider/model:
hermes setup                 # select: ollama-cloud provider, glm-5 model

# Set HERMES_HOME and start the gateway:
export HERMES_HOME=/home/etech/hermes/.hermes   # (local dev: /Users/etech/Desktop/hermes/.hermes)
hermes gateway run --replace
```

On macOS the gateway is managed by **launchd** (`ai.hermes.gateway`); on the
GCP host it runs persistently with `HERMES_HOME` exported. Logs:
`.hermes/logs/gateway.log`.

```bash
# macOS launchd control:
launchctl start ai.hermes.gateway
launchctl stop  ai.hermes.gateway
```

### 5. The Hermes dashboard (host, systemd)

The agent's built-in web UI is served on the host and proxied by nginx at
`mc-hermes.spacearmour.io`.

Build the web UI once (uses the bundled node):

```bash
cd .hermes/hermes-agent/web
npm install && npm run build     # output → hermes_cli/web_dist
```

systemd unit `hermes-dashboard` (enabled, `Restart=always`) runs:

```
hermes dashboard --host 172.18.0.1 --port 9119 --insecure --no-open --skip-build
Environment=HERMES_HOME=/home/etech/hermes/.hermes
```

> **Critical:** `HERMES_HOME` must be set in the unit, otherwise the dashboard
> defaults to an empty `~/.hermes` instead of the real running agent. It binds
> to the docker bridge gateway (`172.18.0.1`), not `0.0.0.0`, so it is never on
> the public interface; nginx rewrites the `Host` header to `172.18.0.1:9119`
> to satisfy the dashboard's anti-DNS-rebinding check.

```bash
sudo systemctl restart hermes-dashboard
sudo systemctl status  hermes-dashboard
```

---

## Per-Service Reference

### postgres / pgvector
- DB `hermes_auth`, user `hermes`, password from `${POSTGRES_PASSWORD}`.
- Holds the Control Hub auth tables and the mem0 vector collection `mem0_memories`.

```bash
docker compose up -d postgres
docker exec -it hermes_postgres psql -U hermes -d hermes_auth
```

### neo4j
- User `neo4j`, password from `${NEO4J_PASSWORD}`, APOC enabled.
- Stores the mem0 entity/relationship graph.

```bash
docker compose up -d neo4j
# Browser UI (loopback only): http://127.0.0.1:7474   (tunnel in if remote)
```

### mem0-server
- FastAPI wrapper around `mem0ai.Memory`. LLM + embeddings via Ollama Cloud,
  vectors in pgvector, graph in Neo4j.

```bash
docker compose up -d --build mem0-server
docker compose logs -f mem0-server
curl http://127.0.0.1:8888/health
```

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Health check |
| POST | `/v1/memories` | Add memories (optional LLM extraction) |
| GET | `/v1/memories?user_id=` | List memories |
| GET | `/v1/memories/search?query=&user_id=` | Semantic search |
| PUT | `/v1/memories/{id}` | Update |
| DELETE | `/v1/memories/{id}` | Delete |
| DELETE | `/v1/memories?user_id=` | Delete all for a user |

### control-hub (Next.js)
- Multi-stage Docker build (`deps` → `builder` → `runner`).
- Runs as the **bind-mount owner uid** via `docker-entrypoint.sh` (gosu) so it
  can read/write the host `.hermes` dir (cron `jobs.json`, profile `config.yaml`/`SOUL.md`).
- The `.hermes` mount **must be `:rw`** — a read-only mount makes cron CRUD and
  profile push fail with EACCES (502s / `sync_error`).
- Auth: middleware gates all routes on an `access_token` cookie (HS256 JWT via
  `jose`, signed with `JWT_ACCESS_SECRET`).

```bash
docker compose up -d --build control-hub
docker compose logs -f control-hub
```

### nginx
- Two vhosts in `nginx/conf.d/`. Base config (`nginx.conf`) defines the
  WebSocket upgrade map and a 50m body limit.

```bash
docker exec hermes_nginx nginx -t        # test config
docker exec hermes_nginx nginx -s reload # reload after editing confs
```

---

## Autonomous Agents (Space Armour Ops)

On top of the platform we run a set of **autonomous operations agents** that
monitor a separate target server (`space-armour-server`) and act on what they
see. Each agent is a small detect → reason → act loop: a mechanical **collector**
gathers telemetry into Postgres, a **cycle** daemon spots anomalies, retrieves the
matching Standard Operating Procedure (SOP) from a pgvector knowledge base,
**reasons about it with glm-5** via the Hermes gateway, and seals an audit trail
(mirrored into Hindsight). They run **inside the `hermes_mem0` container** (no
extra containers) and are bind-mounted `:ro`, so a `docker compose up -d
--force-recreate mem0-server` reloads their code with no image rebuild.

| Agent | Surface | Posture | Enforces? | Detail |
|---|---|---|---|---|
| **Sentinel** | CPU / resource telemetry | detect-and-log | No | [`sentinel/README.md`](sentinel/README.md) |
| **Bastion** | SSH (port 22) brute-force | detect-and-block | Yes (ipset/iptables + optional VPC) | [`bastion/README.md`](bastion/README.md) |

Both target `space-armour-server` (internal `10.128.0.3`, external
`35.253.182.184`, zone `us-central1-f`, same project/VPC as the host). They SSH to
it over the internal IP using a bind-mounted key, and their tables live in the
`hermes_auth` Postgres DB. The LLM is cloud (glm-5); **embeddings are local**
(`multi-qa-MiniLM-L6-cos-v1`, 384-dim) because Ollama Cloud has no embeddings API.

### Sentinel — telemetry watchdog (detect + log)

Watches the target's CPU/memory/disk/net over SSH. On a spike it identifies the
culprit process, pulls the matching SOP, asks glm-5 to explain it, and writes a
**sealed `audit_log` row — no remediation**. It is the read-only sibling of
Bastion.

- **Daemons:** `collector.py` (Watchtower, polls every ~10s → `telemetry`) +
  `sentinel_cycle.py` (anomaly → SOP → glm-5 → `audit_log` → Hindsight).
- **Tables (`hermes_auth`):** `telemetry`, `audit_log`, `sops` (pgvector).
- **Thresholds:** CPU > 90 ⇒ CRITICAL, > 70 ⇒ WARN (see `sentinel/thresholds.py`).
- **Demo:** spike the target — `stress-ng --cpu 4 --timeout 30s` — or hit the
  bundled CPU-load API (`:8099/spike?token=…`); within ~10s a CRITICAL sample is
  recorded and the Sentinel Ops page lights up with the culprit named.

Full setup, deploy, and demo steps: **[`sentinel/README.md`](sentinel/README.md)**.

### Bastion — SSH perimeter guard (detect + enforce)

Watches SSH login activity and **actively firewalls** brute-force sources, then
auto-releases them.

- **Rule:** > 5 SSH attempts from one IP within 60s ⇒ block that IP for **5
  minutes** (`BASTION_BLOCK_SECONDS=300`), then auto-unblock. Counts *all*
  attempts, not just failures.
- **Daemons:** `collector.py` (Gatekeeper → `ssh_events`) + `bastion_cycle.py`
  (aggregate → glm-5 → block + expiry sweeper).
- **Tables (`hermes_auth`):** `ssh_events`, `ssh_blocks`, `ssh_audit_log`,
  `bastion_sops`.
- **Enforcement — two layers:**
  - **Host (always on):** `ipset add bastion_block <ip> timeout 300` on the target
    + a standing `iptables -I INPUT 1 … --match-set bastion_block src tcp dpt:22
    -j DROP`, layered over the VM's `ufw`. The ipset is **IPv4-only**.
  - **VPC edge (optional, off by default):** when `BASTION_VPC_ENABLE=true`, also
    creates a GCP INGRESS DENY rule for the `/32`; requires a service-account key.
- **Self-block safety:** all private ranges + loopback are always whitelisted
  (the monitoring path is never blocked); add your public admin IP via
  `BASTION_WHITELIST`. If you block your own IP you lose SSH to the target — wait
  out the TTL or get in via `gcloud compute ssh … --tunnel-through-iap` (IAP's
  source range is never blocked).
- **Decision text** shown on the Ops page is glm-5-generated and fed the *live*
  block duration, so it always states the real TTL.
- **Demo (IPv4!):**
  ```bash
  # from a NON-whitelisted box — must be IPv4 (the ipset is IPv4-only)
  for i in $(seq 1 10); do ssh -4 -o BatchMode=yes -o ConnectTimeout=6 \
    -o PreferredAuthentications=publickey "baduser_$i@35.253.182.184" true 2>/dev/null; done
  sleep 50                                  # detection takes ~5–50s (poll+cycle+LLM)
  ssh -4 -o ConnectTimeout=15 etech@35.253.182.184 true   # → "Operation timed out" while blocked
  ```

Full configuration, deploy loop, synthetic-injection testing, VPC setup, and
troubleshooting: **[`bastion/README.md`](bastion/README.md)**.

### Crew profiles

The agents are backed by Hermes **profiles** under `.hermes/profiles/` that appear
as the "crew" in the Mission Control roster: Sentinel's `sentinel` + `watchtower`
(mem0) and `archivist` + `auditor` (Hindsight); Bastion's `gatekeeper`,
`bastion`, `warden`, and `perimeter-auditor`. Profiles only show in the dashboard
once registered in the Control Hub's SQLite `agent_profiles` table.

> A **Hermes-native rebuild** of these agents also ships in the repo
> (`.hermes/scripts/*_probe.py` + `.hermes/skills/space-armour/*`), expressing each
> agent as a profile + cron routine + skill instead of a standalone daemon. The
> standalone daemons described above are what currently runs in production; the
> native routines are build-alongside and not yet registered.

### Mission Control Ops pages

Each agent has a live flow page in the Control Hub (`mc.spacearmour.io`):

- **Sentinel Ops** (`/sentinel`) — node/edge canvas Target → Watchtower →
  Sentinel → {Archivist, Auditor, Memory}, event-driven pulse animation, fed by
  `telemetry` + `audit_log`.
- **Perimeter Ops** (`/bastion`) — the same flow for the SSH guard **plus an
  Active Blocks table** with live countdowns driven by each block's `expires_at`.

These read Postgres directly via `src/lib/{sentinel,bastion}-repository.ts`; the
pages poll every ~2.5s and pulse on new events.

---

## Updating / Redeploying

The server checkout at `/home/etech/hermes` tracks `origin/main`. It carries
untracked runtime files that must **not** be cleaned: `nginx/conf.d/.htpasswd`,
the `mc-hermes` vhost conf, and the runtime `.hermes/` dirs.

```bash
# Locally: commit + push to main, then on the server:
git fetch origin && git reset --hard origin/main   # safe: server never diverges; leaves untracked files
docker compose up -d --build control-hub           # rebuild just the changed service
```

Rebuild a specific service after editing its source:

```bash
docker compose build mem0-server && docker compose up -d mem0-server
docker compose up -d --build control-hub
```

After editing `server.py` (mem0) or any Next.js source, a rebuild is required —
the images bake the code in.

---

## Operations & Troubleshooting

**Check status / logs**
```bash
docker compose ps
docker compose logs -f <service>
sudo ss -ltnp | grep -E ':5432|:7474|:7687|:8888'   # should all be 127.0.0.1
```

**Gateway down (macOS)**
```bash
launchctl start ai.hermes.gateway
# or run directly:
HERMES_HOME=/Users/etech/Desktop/hermes/.hermes hermes gateway run --replace &
```

**mem0 server down**
```bash
docker compose up -d mem0-server
```

**Dashboard shows the wrong/empty agent** — `HERMES_HOME` is not set in the
`hermes-dashboard` systemd unit. Add it and `systemctl restart hermes-dashboard`.

**Control Hub cron 502 / profile `sync_error`** — the `.hermes` mount is `:ro`
or owned by the wrong uid. It must be `:rw` and mode-700 owned by the same uid
the gateway runs as. Test writes with `docker exec -u <uid> hermes_control_hub`.

**"Hermes venv Python not found"** — the runner image must install `python3`
(bookworm 3.11, matching the venv) so `venv/bin/python3 → /usr/bin/python3`
resolves.

### Rotating database passwords

Because passwords only apply at first volume init, rotate **in place**:

```bash
# Postgres (loopback trust allows the ALTER with no current password):
docker exec -it hermes_postgres psql -U hermes -d hermes_auth \
  -c "ALTER USER hermes WITH PASSWORD '<new>';"

# Neo4j (needs the current password):
docker exec -it hermes_neo4j cypher-shell -u neo4j -p '<current>' \
  "ALTER USER neo4j SET PASSWORD '<new>';"

# Update .env, then recreate the consumers so they reconnect:
docker compose up -d --force-recreate mem0-server control-hub
```

> Verification gotchas: postgres `pg_hba` grants `trust` on loopback, so any
> password "works" from inside the container — test the real scram path from
> another container against host `postgres`. The mem0 image has no
> `psql`/`cypher-shell`, so exec-based DB tests there always fail regardless of
> the password; rely on the mem0 health endpoint instead.

---

## Security Notes

- **Only ports 80/443 are public.** postgres, neo4j, mem0, and control-hub are
  bound to `127.0.0.1` or `expose`d internally on the Docker network.
- **mem0 has no auth of its own** — it is protected solely by loopback binding.
  Never publish `8888` on a public interface.
- **The Hermes dashboard has no real login** (the SPA injects a session token
  for any browser that loads it). It is gated by **nginx Basic Auth** at
  `mc-hermes.spacearmour.io` — keep `.htpasswd` populated and out of git.
- DB passwords and JWT secrets live **only** in the server `.env` (gitignored);
  `.env.example` ships placeholders.
- The Control Hub gateway calls carry `Authorization: Bearer
  $HERMES_GATEWAY_API_KEY`, which must equal the gateway's `API_SERVER_KEY`.
```
