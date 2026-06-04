# SOP-002 — RAM Bus Saturation (Memory Pressure)

**Subsystem:** Memory
**Trigger:** RAM bus saturation (Memory %) above 75% (WARN) or 90% (CRITICAL).

## Meaning
High memory utilisation risks allocation failures and swapping. On a satellite
this maps to a subsystem buffering more telemetry or payload data than the
memory bus can hold, which can stall downlink staging.

## Detection procedure
1. Confirm the breach against two consecutive telemetry samples.
2. Identify the highest-memory process: name, PID, owning user, and resident
   memory share.
3. Note whether usage is climbing steadily (possible leak) or flat-but-high.

## What to log
- The offending process name and PID.
- Memory percentage at detection and whether it is trending up.
- Severity and telemetry timestamp.

## Notes
Detect-and-log only. No process is terminated. The operator reviews the audit
trail to decide on any manual action.
