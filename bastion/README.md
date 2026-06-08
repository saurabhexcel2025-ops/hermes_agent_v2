# Bastion — Autonomous SSH Perimeter Guard

Bastion is an autonomous agent that watches the SSH surface of the protected
server, detects brute-force / password-spray bursts, reasons about them with an
LLM, and **actively firewalls the offending IP** — then auto-releases it after a
time-boxed block. It is a self-contained mirror of **Sentinel** (which only
*detects and logs* CPU/telemetry anomalies); Bastion **enforces**.

It watches the same target (`space-armour-server`) but is otherwise fully
separate: own daemons, own Postgres tables, own SOP knowledge base, own crew
profiles, and its own **Perimeter Ops** page in the Mission Control dashboard.

---

## 1. The rule

> **More than 5 SSH attempts from one source IP within 60 seconds ⇒ block that IP
> from SSH for 5 minutes, then auto-unblock.**

- Counts **all** SSH attempts (successful, failed, invalid-user, pre-auth drops) —
  not just failures.
- Severity is `WARN`, or `CRITICAL` at ≥ 2× the threshold (≥ 10 in 60s).
- All three knobs are configurable (see [Configuration](#5-configuration)). The
  block duration is currently **5 minutes**.

---

## 2. How it works (the pipeline)

```
space-armour-server (target)
        │  sshd auth/connection events (journalctl / auth.log)
        ▼
  Gatekeeper  →  collector.py     reads events over SSH → ssh_events table
        │
        ▼
  Bastion     →  bastion_cycle.py  aggregate per-IP over 60s window
        │                          │
        │                          ├─ over threshold?
        │                          ├─ NOT whitelisted?
        │                          └─ NOT already blocked?
        │                                   │ yes
        │                                   ▼
        │                          retrieve SOP-101 (pgvector) → reason with glm-5
        ▼
  Warden      →  enforce           ipset add bastion_block <ip> timeout 300   (host)
        │                          + VPC INGRESS DENY rule for <ip>/32:22      (edge, optional)
        ▼
  Auditor     →  seal             ssh_audit_log + ssh_blocks rows; mirror to Hindsight
        │
        ▼
  Sweeper     →  every cycle      once expires_at passes: delete VPC rule + ipset
                                  entry, set ssh_blocks.released_at
```

1. **Gatekeeper** (`collector.py`) reads recent `sshd` events from the target over
   SSH (journalctl `_COMM=sshd` preferred, `/var/log/auth.log` fallback) and
   writes them to `ssh_events` (idempotent via a `raw_hash` UNIQUE index).
2. **Bastion** (`bastion_cycle.py`) aggregates attempts per source IP over the
   trailing 60 s. Any IP over the threshold that is **not whitelisted** and **not
   already under an active block** is reasoned over with **glm-5** (via the Hermes
   gateway), grounded in the retrieved SOP.
3. **Warden** applies the block at the host (`ipset` + standing iptables DROP) and,
   when enabled, at the VPC network edge (firewall DENY rule).
4. **Auditor** seals an audit row in `ssh_audit_log`, records the block in
   `ssh_blocks`, and mirrors the incident into Hindsight (best-effort).
5. **Sweeper** (inside the same cycle) releases expired blocks: ipset auto-expires
   its own entry; the VPC rule has no TTL, so the sweeper deletes it and marks
   `released_at`.

> **Decision text is model-generated.** The human-readable reasoning shown on the
> Perimeter Ops page ("Latest decision…") is produced by glm-5, not hardcoded. The
> prompt is fed the *live* block duration, so the text always states the real TTL
> (e.g. "blocked for 5 minutes"). Changing the block duration updates the wording
> automatically — no code change needed.

---

## 3. The firewall (what actually blocks traffic)

Enforcement happens at up to two layers. **Layer 1 is always on; Layer 2 is
optional.**

### Layer 1 — Host firewall on the target VM (active)
Lives **inside the `space-armour-server` VM**:

- **ufw** is the base firewall (default deny incoming; allows 22/80/443).
- **iptables `INPUT` policy is `DROP`**, with Bastion's rule pinned at **position 1**,
  ahead of the ufw chains:
  ```
  iptables -I INPUT 1 -m set --match-set bastion_block src -p tcp --dport 22 -j DROP
  ```
- **`bastion_block`** is an `ipset` of type `hash:ip` (**IPv4 / `family inet`**).
  When Bastion blocks an IP it runs `ipset add bastion_block <ip> timeout 300`;
  the entry auto-expires after the TTL.

A blocked IP's SSH packets are silently dropped → the client sees a **connection
timeout**, not a refusal. After the TTL the ipset entry disappears and SSH works
again.

> **IPv4 only.** The ipset and iptables rule are IPv4. Connections must arrive over
> IPv4 to be blockable — see [Demo](#7-demo--testing).

### Layer 2 — VPC edge firewall (optional, currently OFF)
When `BASTION_VPC_ENABLE=true`, each block also creates a GCP **INGRESS DENY**
firewall rule (`bastion-deny-<ip-dashed>`, priority 100, tcp:22) for the attacker
`/32`, so the IP is dropped at the network edge *before* reaching the VM.

This requires a dedicated service-account key with firewall permissions and is
**disabled by default** (no key present). See
[VPC edge enforcement](#8-vpc-edge-enforcement-optional). The host layer alone is
fully functional for blocking SSH.

---

## 4. ⚠️ Self-block protection (mandatory reading)

Because Bastion counts **all** SSH attempts, the monitoring path itself (and you,
the admin) could trip the rule and get locked out. Two safeguards:

- **Whitelist** (`whitelist.py`) — checked *before* any block. It **always**
  includes loopback + all private ranges (`127/8, 10/8, 172.16/12, 192.168/16,
  ::1, fc00::/7`), so the internal monitoring path (`10.128.0.x`) and in-VPC
  services are never blocked. Add your **public admin IP** via `BASTION_WHITELIST`
  to make yourself un-blockable.
- The demo brute-forcer must run from a **non-whitelisted** IP, otherwise nothing
  happens.

### If you lock yourself out
Blocking your own public IP blocks **all** your SSH to the target — including
`gcloud compute ssh` (it connects to the same `:22`). To recover:

1. **Wait it out** — any block auto-releases after the TTL (currently 5 min).
2. **Use IAP** (works even while blocked) — IAP tunnels arrive from Google's range
   (`35.235.240.0/20`), a different source IP that Bastion does not block:
   ```bash
   gcloud compute ssh space-armour-server \
     --project=mission-control-497604 --zone=us-central1-f --tunnel-through-iap
   ```
3. **Whitelist your IP** so it never happens again (loses demo-blockability for
   that IP):
   ```bash
   # in the server .env, then recreate the container
   BASTION_WHITELIST=<your.public.ip>
   ```

---

## 5. Configuration

All knobs are environment variables (set in the server `.env`, passed through
`docker-compose.yml`). Defaults shown.

| Variable | Default | Meaning |
|---|---|---|
| `BASTION_ATTEMPTS` | `5` | Trip the rule above this many attempts… |
| `BASTION_WINDOW_SECONDS` | `60` | …within this trailing window. |
| `BASTION_BLOCK_SECONDS` | `300` | Block duration (TTL). **Currently 300 = 5 min.** |
| `BASTION_CRITICAL_FACTOR` | `2.0` | ≥ threshold × this ⇒ `CRITICAL`. |
| `BASTION_WHITELIST` | *(empty)* | Extra never-block IPs/CIDRs (comma-sep). Private ranges always included. |
| `BASTION_IPSET_NAME` | `bastion_block` | ipset name on the target. |
| `BASTION_TARGET_HOST` | `10.128.0.3` | Target internal IP (SSH from the container). |
| `BASTION_TARGET_USER` | `etech` | SSH user on the target. |
| `BASTION_SSH_KEY` | `/data/bastion/id_target` | Key for the monitoring SSH. |
| `BASTION_VPC_ENABLE` | `false` | Turn on Layer-2 VPC edge enforcement. |
| `BASTION_GCP_PROJECT` | *(empty)* | GCP project for VPC rules. |
| `BASTION_GCP_SA_KEY` | `/data/bastion/gcp-fw-sa.json` | SA key for the Compute API. |
| `BASTION_VPC_PRIORITY` | `100` | DENY rule priority (must beat allow-ssh). |

### Changing the block duration
```bash
gcloud compute ssh etech@mission-control-one --zone us-central1-a \
  --project mission-control-497604 --command '
  cd /home/etech/hermes
  sed -i "s/^BASTION_BLOCK_SECONDS=.*/BASTION_BLOCK_SECONDS=300/" .env
  docker compose up -d --force-recreate mem0-server
'
```
The decision text and the Active-Blocks countdown follow this value automatically.

---

## 6. Live deployment

Bastion runs **on the server `mission-control-one`** (GCP, project
`mission-control-497604`, zone `us-central1-a`), where Postgres (loopback), the
target SSH path, and the Hermes gateway all live.

- **Daemons run inside the `hermes_mem0` container** (no separate container). The
  compose `command` runs `bastion/supervisor.sh` (backgrounds `collector.py` +
  `bastion_cycle.py`) then hands off to Sentinel's supervisor. Bastion code is
  bind-mounted `./bastion:/data/bastion:ro`, so recreating the container reloads
  it — no image rebuild needed for daemon-code changes.
- **Target:** `space-armour-server` — internal `10.128.0.3`, external
  `35.253.182.184`, zone `us-central1-f`, same project/VPC.
- **Postgres tables** live in the `hermes_auth` DB.
- **Dashboard login:** `info@spacearmour.io` (the operator account in the `users`
  table).

### Deploy a change (the standard loop)
```bash
# local
git push origin HEAD:main              # fast-forward main

# server
gcloud compute ssh etech@mission-control-one --zone us-central1-a \
  --project mission-control-497604 --command '
  cd /home/etech/hermes
  git fetch origin && git reset --hard origin/main
  # if the SOP changed, re-ingest it into bastion_sops:
  docker exec hermes_mem0 bash -c "cd /data/bastion && python ingest_sops.py"
  # reload daemons (and rebuild control-hub only if the UI changed):
  docker compose up -d --force-recreate mem0-server
'
```

> The `.env` is gitignored, so `git reset --hard` does **not** wipe your
> `BASTION_*` overrides.

---

## 7. Demo / testing

### A. Live brute-force from a real machine
Run from a **non-whitelisted** box. **Use IPv4** (`ssh -4` → IPv4 target literal)
because the ipset is IPv4-only:

```bash
# 1) fire the burst (10 attempts > the 5/60s threshold)
for i in $(seq 1 10); do
  ssh -4 -o BatchMode=yes -o StrictHostKeyChecking=no -o ConnectTimeout=6 \
      -o PreferredAuthentications=publickey "baduser_$i@35.253.182.184" true 2>/dev/null
  echo "attempt $i sent"
done

# 2) wait ~50s for detection (collector poll + cycle + glm reasoning)
sleep 50

# 3) prove the block — this should now TIME OUT
ssh -4 -o BatchMode=yes -o ConnectTimeout=15 etech@35.253.182.184 true
```

- **Blocked** → `connect to host 35.253.182.184 port 22: Operation timed out`
- **Not blocked / after TTL** → `Permission denied (publickey)`

> **Detection is not instant.** The burst attempts complete normally — that's how
> they get *logged* so Bastion can *see* them. The block lands ~5–50 s later (poll
> + cycle + LLM). The Perimeter Ops page then lights up red and the IP appears in
> **Active Blocks** with a live countdown.

`loadgen/brute_force.sh <target-public-ip> 12` is a packaged version of the burst.

### B. Synthetic injection (no real SSH needed — fast verification)
Insert events directly, let the live cycle block them, then inspect:

```bash
# inject 8 events for a non-whitelisted test IP (TEST-NET-3 = safe)
docker exec -i hermes_postgres psql -U hermes -d hermes_auth <<'SQL'
INSERT INTO ssh_events (event_ts, target, src_ip, username, result, raw, raw_hash)
SELECT now() - (g * interval '1 second'), '10.128.0.3', '203.0.113.10',
       'root', 'failed', 'synthetic '||g, md5('t-'||g||clock_timestamp()::text)
FROM generate_series(1,8) g;
SQL

sleep 50
docker exec hermes_postgres psql -U hermes -d hermes_auth -c \
 "SELECT src_ip, EXTRACT(EPOCH FROM (expires_at-blocked_at))::int AS secs, reason
  FROM ssh_blocks WHERE src_ip='203.0.113.10' ORDER BY id DESC LIMIT 1;"
```
> Tip: when scripting through `gcloud ssh → docker → psql`, quotes get mangled.
> Base64-encode the SQL locally and `base64 -d | docker exec -i … psql` on the
> server.

### Verify live state at any time
```bash
# active blocks + time left
docker exec hermes_postgres psql -U hermes -d hermes_auth -c \
 "SELECT src_ip, blocked_at, expires_at,
         GREATEST(0,EXTRACT(EPOCH FROM (expires_at-now()))::int) AS secs_left
  FROM ssh_blocks WHERE expires_at>now() ORDER BY id DESC;"

# ipset contents on the target
docker exec hermes_mem0 bash -c \
 "ssh -i /data/sentinel/id_target -o StrictHostKeyChecking=no etech@10.128.0.3 \
  'sudo ipset list bastion_block'"
```

---

## 8. VPC edge enforcement (optional)

Defense-in-depth: drop the attacker `/32` at the GCP network edge as well as the
host. **Disabled by default** (no service-account key present).

To enable:
1. In the GCP console (project `mission-control-497604`), create a custom role
   with `compute.firewalls.{create,delete,get,list}` +
   `compute.networks.{updatePolicy,get}`, a service account, bind the role, and
   download a JSON key.
2. Place the key at `bastion/gcp-fw-sa.json` (gitignored; bind-mounted into the
   container).
3. Set in `.env` and recreate the container:
   ```
   BASTION_VPC_ENABLE=true
   BASTION_GCP_PROJECT=mission-control-497604
   ```

Each block then creates `bastion-deny-<ip>` (priority 100 > the prio-65534
`default-allow-ssh`, so DENY wins). VPC rules have no TTL, so the cycle's sweeper
deletes them on expiry.

> Note: a VPC block of the attacker `/32` does **not** stop GCP console "browser
> SSH" — that arrives via the IAP range `35.235.240.0/20`, a different source.

---

## 9. First-time setup (fresh install)

```bash
# 1. DB tables + SOP KB (from repo root, against hermes_auth)
psql "$DATABASE_URL" -f bastion/schema.sql
python bastion/ingest_sops.py

# 2. On the TARGET server, once (installs ipset, the iptables rule, sudo grant):
sudo bash bastion/target_setup.sh etech
#    NB: iptables/ipset are NOT reboot-persistent — re-run on boot or install the
#    *-persistent packages.

# 3. Configure bastion/.env (see .env.example), drop the SSH key at
#    bastion/id_target (gitignored), then (re)create the mem0 container — the
#    daemons start via supervisor.sh.
```

---

## 10. Files

| File | Role |
|---|---|
| `schema.sql` | Tables: `ssh_events`, `ssh_blocks`, `ssh_audit_log`, `bastion_sops` |
| `probe.py` | SSH log reader + shared `ssh_exec()` |
| `collector.py` | Gatekeeper daemon → `ssh_events` |
| `bastion_cycle.py` | detect → reason (glm-5) → block (ipset + VPC) + expiry sweeper |
| `vpc_block.py` | VPC edge firewall DENY create/delete via Compute API |
| `whitelist.py` | never-block IP/CIDR matcher (private ranges always included) |
| `thresholds.py` | the `ATTEMPTS / WINDOW / BLOCK / CRITICAL_FACTOR` knobs |
| `embeddings.py`, `db.py` | local embeddings + DB helpers |
| `ingest_sops.py` + `sop/` | Bastion's own SOP knowledge base (pgvector) |
| `supervisor.sh` | backgrounds the daemons inside the mem0 container |
| `target_setup.sh` | one-time target prep (ipset + iptables + sudo) |
| `loadgen/brute_force.sh` | demo trigger |

## 11. Database schema (in `hermes_auth`)

| Table | Purpose |
|---|---|
| `ssh_events` | every observed SSH attempt (`event_ts, src_ip, username, result, raw_hash`) |
| `ssh_blocks` | each block (`src_ip, blocked_at, expires_at, released_at, attempt_count, reason, audit_id`) |
| `ssh_audit_log` | sealed decision trail (severity, sop_ref, reasoning, confidence, action_taken) |
| `bastion_sops` | SOP knowledge base (pgvector embeddings) |

---

## 12. Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| Burst doesn't block | Source IP is whitelisted (private range, or in `BASTION_WHITELIST`); or you connected over IPv6 — use `ssh -4`. |
| Block didn't appear immediately | Normal — detection takes ~5–50 s (poll + cycle + LLM). Wait, then re-check. |
| You're locked out of the target | You blocked your own IP. Wait for the TTL, or use `--tunnel-through-iap`. |
| Decision text shows a wrong duration | The stored SOP drifted — re-run `ingest_sops.py` on the server; the prompt injects the live `BLOCK_SECONDS`. |
| ipset/iptables gone after target reboot | They aren't reboot-persistent; re-run `target_setup.sh` or install `*-persistent`. |
| VPC rules never created | `BASTION_VPC_ENABLE` is false or the SA key is missing (`bastion/gcp-fw-sa.json`). |
