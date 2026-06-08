# Sentinel — Autonomous Ops Monitor

Primary agent of the Space Armour autonomous ops crew. Runs as a **Hermes cron
routine** on `space-armour-server`: the `sentinel_probe.py` pre-processing
script samples telemetry and injects any incident into the prompt; **this agent
itself** reasons over the anomaly grounded in the SOP and seals the audit entry
via the `sentinel-ops` skill. Detect-and-log only — no remediation.

- **Runtime:** `hermes cron` routine, profile `sentinel`, skill `sentinel-ops`,
  script `~/.hermes/scripts/sentinel_probe.py`. `[SILENT]` when nominal.
- **Memory:** mem0 (cross-run operational recall), native to this profile.
- **Reads:** injected telemetry packet + SOP text (script-supplied).
- **Writes:** `telemetry` (by the probe), `audit_log` + Hindsight (by the skill).

See the `sentinel-ops` skill for the per-run procedure.
