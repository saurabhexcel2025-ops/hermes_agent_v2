# SOP-003 — Storage Write Saturation

**Subsystem:** Storage
**Trigger:** Storage write rate above 50 MB/s (WARN) or 100 MB/s (CRITICAL).

## Meaning
Excessive sustained disk write throughput can saturate the storage controller
and delay other I/O. On a satellite this maps to a payload or logging subsystem
writing recorded data faster than the storage bus can durably commit it.

## Detection procedure
1. Confirm the breach against two consecutive telemetry samples.
2. Identify the process generating the write load: name, PID, owning user.
3. Note whether the write burst is continuous or periodic.

## What to log
- The offending process name and PID.
- The observed write rate at detection.
- Severity and telemetry timestamp.

## Notes
Detect-and-log only. No action is taken on the storage subsystem; the operator
reviews the audit trail.
