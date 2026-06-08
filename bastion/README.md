# Bastion — Autonomous SSH Perimeter Guard

A fully self-contained sub-system that mirrors **Sentinel** but defends the SSH
surface instead of watching CPU/telemetry. It watches the **same target server**
(`space-armour-server`) and is otherwise completely separate: own daemons, own
Postgres tables, own SOP KB, own crew profiles, own Ops page.

## Rule
> More than **5 SSH attempts** from one source IP within **60 seconds** ⇒ block
> that IP from SSH for **5 minutes**, then auto-unblock.

Unlike Sentinel (detect-and-log only), Bastion **enforces** — at both the host
(ipset) and the VPC network edge (firewall).

## How it works
1. **Gatekeeper** (`collector.py`) reads recent `sshd` events from the target
   over SSH (journalctl preferred, `/var/log/auth.log` fallback) → `ssh_events`.
2. **Bastion** (`bastion_cycle.py`) aggregates attempts per IP over the trailing
   60s. Any IP over the threshold that is **not whitelisted** and **not already
   blocked** is reasoned over with **glm-5** (grounded in `sop/ssh-brute-force.md`).
3. **Warden** applies the block two ways: `ipset add bastion_block <ip> timeout
   300` on the target (a standing iptables rule drops the set), **and** — when
   `BASTION_VPC_ENABLE=true` — a VPC edge firewall DENY rule for the `/32` on
   tcp:22 via the Compute API. ipset auto-expires; the VPC rule has no TTL, so
   the cycle's `sweep_expired` deletes it (and marks `released_at`) on expiry.
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
| `bastion_cycle.py` | detect → reason → block (ipset + VPC) + expiry sweeper |
| `vpc_block.py` | VPC edge firewall DENY create/delete via Compute API |
| `whitelist.py` | never-block IP/CIDR matcher |
| `thresholds.py` | the 5 / 60s / 5m knobs |
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
#   5-minute countdown, and SSH from it is dropped (host + VPC edge) until expiry.
```

## VPC edge enforcement (optional, defense-in-depth)
When `BASTION_VPC_ENABLE=true`, each block also creates an INGRESS DENY firewall
rule (priority 100, tcp:22) for the attacker `/32` in `BASTION_GCP_PROJECT`, so
the IP is dropped at the network edge before reaching the VM. Requires a
service-account key (`bastion/gcp-fw-sa.json`, gitignored) with a role granting
`compute.firewalls.{create,delete,get,list}` + `compute.networks.updatePolicy`.
The sweeper deletes the rule when the block expires.
