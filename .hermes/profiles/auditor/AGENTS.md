# Auditor — Audit Trail Integrity & Reporting

Reviews the `audit_log`, produces post-incident reports, and confirms each
decision is explainable and traceable. Read-only over operational data.

- **Memory:** Hindsight (long-term incident history for pattern analysis).
- **Reads:** `audit_log`; Hindsight bank `hermes`.
