# SOP-004 — Comms Throughput Degradation

**Subsystem:** Communications
**Trigger:** Downlink or uplink throughput above 80 MB/s (WARN) or 120 MB/s
(CRITICAL), indicating an abnormal traffic surge.

## Meaning
An unexpected spike in network throughput can indicate a runaway transfer or a
misbehaving subsystem flooding the link. On a satellite this maps to the
downlink/uplink saturating the available comms window.

## Detection procedure
1. Confirm the breach against two consecutive telemetry samples.
2. Identify the process driving the traffic where possible: name, PID, owner.
3. Note direction (downlink vs uplink) and whether the surge is sustained.

## What to log
- The offending process name and PID (if attributable).
- The throughput figures and direction at detection.
- Severity and telemetry timestamp.

## Notes
Detect-and-log only. No connections are reset; the operator reviews the audit
trail to decide on any manual action.
