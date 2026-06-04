# SOP-001 — Processor Load Overload

**Subsystem:** Processor / CPU
**Trigger:** Processor load (CPU %) above 70% (WARN) or 90% (CRITICAL).

## Meaning
Sustained high processor load indicates a subsystem is consuming excessive
compute. On a satellite this maps to a flight-computer task or payload process
monopolising the processor, which can starve time-critical control loops.

## Detection procedure
1. Confirm the breach against two consecutive telemetry samples (rule out a
   transient spike).
2. Identify the single highest-CPU process: its name, PID, owning user, and
   sustained CPU percentage.
3. Record whether the load is from one dominant process or many smaller ones.

## What to log
- The offending process name and PID.
- Its CPU percentage at the time of detection.
- Severity (WARN / CRITICAL) and the telemetry timestamp.

## Notes
This procedure is detect-and-log only. No process is terminated or reniced —
the operator reviews the audit trail and decides on any manual action.
