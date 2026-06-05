# Bastion — Autonomous SSH Perimeter Guard

A fully self-contained sub-system that mirrors **Sentinel** but defends the SSH
surface instead of watching CPU/telemetry. It watches the **same target server**
(`space-armour-server`) and is otherwise completely separate: own daemons, own
Postgres tables, own SOP KB, own crew profiles, own Ops page.

## Rule
> More than **5 SSH attempts** from one source IP within **60 seconds** ⇒ block
> that IP from SSH for **1 hour**, then auto-unblock.

Unlike Sentinel (detect-and-log only), Bastion **enforces**.

## How it works
1. **Gatekeeper** (`collector.py`) reads recent `sshd` events from the target
   over SSH (journalctl preferred, `/var/log/auth.log` fallback) → `ssh_events`.
2. **Bastion** (`bastion_cycle.py`) aggregates attempts per IP over the trailing
   60s. Any IP over the threshold that is **not whitelisted** and **not already
   blocked** is reasoned over with **glm-5** (grounded in `sop/ssh-brute-force.md`).
3. **Warden** applies the block: `ipset add bastion_block <ip> timeout 3600`. A
   standing iptables rule drops everything in the set; ipset's per-entry timeout
   auto-expires the block after 1h (**no unblock sweeper needed**).
4. **Auditor** seals a row in `ssh_audit_log` and records the block in
   `ssh_blocks`; the incident is mirrored into Hindsight (best-effort).

## ⚠️ Self-block protection (mandatory)
Because we count **all** SSH attempts, the monitoring probe's own SSH (every few
seconds from mission-control-one) would itself exceed the rule. The whitelist
(`whitelist.py`) **always** includes all private ranges + loopback, so the
internal monitoring path and any in-VPC service are never blocked. Add your
**public admin IP** via `BASTION_WHITELIST` so you can't lock yourself out.
The demo brute-forcer must run from a **non-whitelisted** IP.

## Files
| File | Role |
|---|---|
| `schema.sql` | `ssh_events`, `ssh_blocks`, `ssh_audit_log`, `bastion_sops` |
| `probe.py` | SSH log reader + shared `ssh_exec()` |
| `collector.py` | Gatekeeper daemon → `ssh_events` |
| `bastion_cycle.py` | detect → reason → ipset block |
| `whitelist.py` | never-block IP/CIDR matcher |
| `thresholds.py` | the 5 / 60s / 1h knobs |
| `ingest_sops.py` + `sop/` | Bastion's own SOP KB |
| `supervisor.sh` | backgrounds the daemons in the mem0 container |
| `target_setup.sh` | one-time target prep (ipset + iptables + sudo) |
| `loadgen/brute_force.sh` | demo trigger |

## Setup
```bash
# 1. DB tables + SOP KB (from the repo root, against hermes_auth)
psql "$DATABASE_URL" -f bastion/schema.sql
python bastion/ingest_sops.py

# 2. On the TARGET server, once:
sudo bash target_setup.sh etech     # installs ipset, iptables rule, sudo grant

# 3. Configure bastion/.env (see .env.example), drop the SSH key at
#    bastion/id_target (gitignored), then (re)build the mem0 container — the
#    daemons start via supervisor.sh.
```

## Demo
```bash
# From a NON-whitelisted box:
bastion/loadgen/brute_force.sh <target-public-ip> 12
# → Perimeter Ops page lights up red, the IP appears in Active Blocks with a
#   1-hour countdown, and SSH from it is dropped until it expires.
```
