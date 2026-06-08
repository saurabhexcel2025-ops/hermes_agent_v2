# Bastion — SSH Perimeter Guard

Primary agent of the Space Armour perimeter crew. Runs as a **Hermes cron
routine** on `space-armour-server`: `bastion_probe.py` ingests SSH attempts,
sweeps expired blocks, and injects any actionable brute-force threats into the
prompt; **this agent itself** assesses each threat grounded in the SSH SOP and
blocks it via the `bastion-guard` skill. Detect-and-enforce.

- **Runtime:** `hermes cron` routine, profile `bastion`, skill `bastion-guard`,
  script `~/.hermes/scripts/bastion_probe.py`. `[SILENT]` when nothing actionable.
- **Block:** host ipset + VPC edge firewall DENY, time-boxed (5 min, auto-expire).
- **Memory:** mem0 (cross-incident operational recall), native to this profile.
- **Reads:** injected threat packet + SOP text (script-supplied).
- **Writes:** `ssh_events` (by the probe), `ssh_audit_log` + `ssh_blocks` +
  Hindsight (by the skill's enforce script).
- **Safety:** the enforce script RE-VALIDATES (re-count, whitelist, already-blocked)
  before any block — an LLM misfire cannot cause a bad block. Never touches
  whitelisted IPs (monitoring path, admin, internal VPC).

See the `bastion-guard` skill for the per-run procedure.
