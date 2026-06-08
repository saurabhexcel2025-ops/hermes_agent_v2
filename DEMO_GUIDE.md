# Space Armour — Autonomous Ops Demo Guide

This document explains the two autonomous-ops agent crews running on
`mission-control-one`, what each agent profile does, how the data flows, and how
to run each demo live.

Both crews watch the **same** production server (`space-armour-server`,
internal `10.128.0.3`) but are **completely independent** sub-systems with their
own daemons, database tables, knowledge bases, agent profiles, and dashboard
pages.

| Crew | Watches | Posture | Dashboard page |
|---|---|---|---|
| **Sentinel** | CPU / telemetry | Detect-and-**log** (never acts) | Sentinel Ops — `/sentinel` |
| **Bastion** | SSH login activity | Detect-and-**block** (enforces) | Perimeter Ops — `/bastion` |

The key contrast for the demo: **Sentinel observes and reports; Bastion observes
and takes a real, time-boxed defensive action.**

---

## Shared foundation (how both crews are built)

- **One target, watched over SSH.** A probe SSHes into `space-armour-server` and
  reads its state — Sentinel reads `/proc` + `ps`; Bastion reads the `sshd` logs.
  Nothing is installed on the target beyond what each needs (Bastion adds `ipset`).
- **Daemons run inside the existing `mem0-server` container** — no extra
  containers. A supervisor backgrounds each crew's daemons, then hands off to the
  mem0 server.
- **Postgres (`hermes_auth`)** stores live data + an immutable audit trail.
- **Reasoning is done by `glm-5`** via the Hermes gateway (OpenAI-compatible API).
- **Each crew has its own SOP knowledge base** in pgvector (384-dim local
  embeddings). The relevant SOP is retrieved and fed to glm-5 so every decision is
  grounded in a written procedure.
- **Memory:** operational recall via `mem0`; incidents are mirrored into the
  `Hindsight` knowledge graph for long-term, cross-incident memory.

```
                ┌─────────────────────────────────────────────┐
   TARGET  ───► │  Collector ──► Detector/Reasoner ──► Outputs │
 (over SSH)     │  (watch)       (glm-5 + SOP)        (audit,   │
                │                                      action,  │
                │                                      memory)  │
                └─────────────────────────────────────────────┘
```

---

# Crew 1 — Sentinel (Autonomous Ops Monitor)

**What it does:** continuously watches the target's resource telemetry (CPU, RAM,
disk, network, process count), detects anomalies against operating thresholds,
identifies the responsible process, reasons about it with glm-5 grounded in an
SOP, and writes a sealed audit-trail entry. **It never takes corrective action.**

### The pipeline
`Target → Watchtower → Sentinel → { Archivist, Auditor, Memory }`

### Agent profiles

| Profile | Role | What it does | How (backing daemon / data) |
|---|---|---|---|
| **Watchtower** | Telemetry monitor | Polls the target every 10s, maps server metrics to "satellite" naming (processor load, RAM saturation, downlink/uplink…), classifies each sample NORMAL / WARN / CRITICAL. | `collector.py` → writes the `telemetry` table. |
| **Sentinel** | Detector + reasoner | On the rising edge into an anomaly, identifies the culprit process, retrieves the matching SOP, asks glm-5 for a plain-English explanation + confidence. | `sentinel_cycle.py`; reads `telemetry` + `sops`; calls glm-5. |
| **Archivist** | SOP knowledge base | Holds the operating procedures; supplies the most relevant SOP for the anomaly so the reasoning is grounded, not guessed. | `sops` table (pgvector), local embeddings. |
| **Auditor** | Audit trail | Seals one immutable row per incident: anomaly, severity, culprit process/PID/CPU, SOP referenced, glm-5 reasoning, confidence. | `audit_log` table. |
| **Memory** | Long-term recall | Mirrors each incident into mem0 (operational recall) and the Hindsight knowledge graph (cross-incident memory). | mem0 + Hindsight. |

### Data flow (one incident)
1. **Watchtower** polls the target → telemetry row (severity classified).
2. CPU crosses the threshold → severity flips NORMAL → CRITICAL.
3. **Sentinel** catches the rising edge, reads the culprit process from the
   sample, and **Archivist** returns the best-matching SOP.
4. **glm-5** explains the anomaly grounded in that SOP and returns a confidence.
5. **Auditor** seals the audit row. **Memory** mirrors it. *No process is killed.*

### How to run the Sentinel demo
The target runs a small CPU-load API (token-gated). Spiking CPU makes Sentinel
detect and log an incident, and the Sentinel Ops page lights up.

```bash
# Burn CPU on the target for 30s with 2 workers:
curl "http://35.253.182.184:8099/spike?token=e96daaf5f7e698bd&seconds=30&workers=2"
# Other endpoints: /status , /stop
```

**What to show on `/sentinel`:** the status strip flips to CRITICAL, the pulse
sweeps Target → Watchtower → Sentinel → branches (red), the live feed narrates
each agent, and the "Latest decision" panel shows the culprit process + glm-5
reasoning + confidence. Emphasize: **it detected, explained, and logged — but did
not touch the process.**

---

# Crew 2 — Bastion (SSH Perimeter Guard)

**What it does:** watches every SSH login attempt on the target. If one source IP
makes **more than 5 SSH attempts in 60 seconds**, Bastion reasons about it with
glm-5 (grounded in an SSH SOP), seals an audit entry, and **blocks that IP from
SSH for 5 minutes** — at both the host (ipset) and the VPC network edge
(firewall) — then the block auto-expires. **This crew enforces.**

### The rule
> More than **5 SSH attempts** from one source IP within **60 seconds**
> ⇒ block that IP from SSH for **5 minutes**, then auto-unblock.

### The pipeline
`Target → Gatekeeper → Bastion → { Warden, Auditor, Memory }`

### Agent profiles

| Profile | Role | What it does | How (backing daemon / data) |
|---|---|---|---|
| **Gatekeeper** | SSH access-log monitor | Reads the target's `sshd` logs over SSH (journalctl, with `/var/log/auth.log` fallback) every few seconds and records each attempt with its source IP. | `collector.py` → writes the `ssh_events` table (idempotent). |
| **Bastion** | Detector + reasoner + enforcer | Aggregates attempts per IP over the trailing 60s; for any IP over the threshold that is **not whitelisted** and **not already blocked**, retrieves the SSH SOP and asks glm-5 to assess the threat. | `bastion_cycle.py`; reads `ssh_events` + `bastion_sops`; calls glm-5. |
| **Warden** | Enforcer | Carries out the block two ways: (1) adds the IP to the target's `bastion_block` ipset with a 5-minute timeout (a standing iptables rule drops the set); (2) creates a VPC **edge** firewall DENY rule for the `/32` on tcp:22, so the attacker is dropped before reaching the VM. ipset auto-expires; the VPC rule has no TTL, so the cycle's sweeper deletes it on expiry. | `ipset add … timeout 300` over SSH + Compute API firewall insert → writes `ssh_blocks`. |
| **Auditor** | Audit trail | Seals one immutable row per detection+block: source IP, attempt count, window, severity, SOP, glm-5 reasoning, confidence, and the exact action taken. | `ssh_audit_log` table. |
| **Memory** | Long-term recall | Mirrors each block into mem0 + the Hindsight knowledge graph. | mem0 + Hindsight. |

### Data flow (one block)
1. **Gatekeeper** continuously records SSH attempts → `ssh_events`.
2. An IP exceeds 5 attempts in 60s.
3. **Bastion** checks the whitelist (skip if trusted), checks it isn't already
   blocked, retrieves the SSH SOP, and **glm-5** assesses the threat (severity +
   confidence).
4. **Warden** adds the IP to the `bastion_block` ipset on the target (5m timeout)
   **and** creates a VPC edge firewall DENY rule for the `/32` — SSH from that IP
   is now dropped both on the host and at the network edge.
5. **Auditor** seals the audit row; **Memory** mirrors it. The block auto-expires
   after 5 minutes (ipset by timeout; the VPC rule via the sweeper).

### 🔒 The safety mechanism worth showing off (the whitelist)
Because Bastion counts **all** SSH attempts, the monitoring probes themselves
(which SSH into the target every few seconds from `mission-control-one`) generate
**~18 attempts/minute** — far over the threshold. Without protection, Bastion
would firewall out its own monitoring **and your admin access**.

The **whitelist** (`whitelist.py`) is checked *before* any block and always
includes every private range + loopback, so the internal monitoring path is never
blocked. This is proven live: the monitoring IP `10.128.0.2` sits at 18/60s and
gets **zero blocks**, while external IPs are blocked normally.

> Demo talking point: "It's aggressive enough to block a brute-forcer in seconds,
> but disciplined enough to never lock out its own operators."

### How to run the Bastion demo
The attacker must come from a **non-whitelisted** IP (i.e. *not* an internal/GCP
box and *not* your admin machine — those are whitelisted by design). Use a
separate VM / Cloud Shell / different network.

```bash
# From a NON-whitelisted box, fire a burst of SSH attempts at the target:
bastion/loadgen/brute_force.sh <target-external-ip> 12
```

**What to show on `/bastion`:** attempts/60s climbs, the status flips to
BLOCKING, the pulse sweeps Target → Gatekeeper → Bastion → Warden (red), the live
feed narrates detection → glm-5 assessment → block, and the **Active Blocks
table** shows the attacker IP with a live **5-minute countdown**. Then prove it's
real: SSH from that IP is refused (host + VPC edge) until the block expires.

---

## Side-by-side: the two postures

| | **Sentinel** | **Bastion** |
|---|---|---|
| Watches | CPU / resource telemetry | SSH login attempts |
| Trigger | metric over threshold | > 5 attempts / 60s from one IP |
| Reasoning | glm-5 + CPU/SOP | glm-5 + SSH/SOP |
| Outcome | **logs** an audit entry | **logs + blocks the IP for 5m** |
| Takes action? | No (observe only) | Yes (host ipset + VPC edge firewall) |
| Dashboard | `/sentinel` | `/bastion` |

Both share the same shape — **watch → reason with glm-5 over an SOP → record** —
which is the reusable autonomous-ops pattern. Bastion extends it with a
disciplined, reversible enforcement step.

---

## Quick demo script (5 minutes)

1. **Open both pages** side by side: `/sentinel` and `/bastion`. Point out they're
   two independent crews watching the same server.
2. **Sentinel:** fire the CPU spike. Narrate the pulse and the "Latest decision"
   panel. Stress: *detected and explained, took no action.*
3. **Bastion — safety first:** show the live `attempts/60s` already high from the
   monitoring traffic, and that **nothing is blocked** — explain the whitelist.
4. **Bastion — the block:** run the brute-force from an external IP. Watch the
   Active Blocks table populate with a 5-minute countdown. Optionally try to SSH
   from that IP and show it's refused.
5. **Close:** same pattern, two postures — autonomous monitoring (Sentinel) and
   autonomous defense (Bastion), each grounded in SOPs and explained by glm-5,
   with a full audit trail and long-term memory.

---

## Reference — where things live

| | Sentinel | Bastion |
|---|---|---|
| Code | `sentinel/` | `bastion/` |
| Tables | `telemetry`, `audit_log`, `sops` | `ssh_events`, `ssh_blocks`, `ssh_audit_log`, `bastion_sops` |
| Profiles | `watchtower`, `sentinel`, `archivist`, `auditor` | `gatekeeper`, `bastion`, `warden`, `perimeter-auditor` |
| Page | `/sentinel` (Sentinel Ops) | `/bastion` (Perimeter Ops) |
| Demo trigger | CPU load API (`/spike`) | `bastion/loadgen/brute_force.sh` |

All daemons run inside the `hermes_mem0` container; reasoning uses `glm-5` via the
Hermes gateway; incidents are mirrored into mem0 + Hindsight.
