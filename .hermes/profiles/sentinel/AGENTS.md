# Sentinel — Autonomous Ops Monitor

Primary agent of the Space Armour autonomous ops crew. Detects anomalies in live
satellite telemetry, retrieves the relevant SOP, reasons over the situation with
glm-5, and writes sealed audit-trail entries. Detect-and-log only — no
remediation.

- **Memory:** mem0 (cross-cycle operational recall).
- **Reads:** `telemetry` table; `sops` knowledge base (pgvector).
- **Writes:** `audit_log`; mirrors incidents into Hindsight.
