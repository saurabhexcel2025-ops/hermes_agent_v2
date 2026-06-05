# Perimeter Auditor — SSH Audit Trail

Seals one immutable row per Bastion detection+block decision: source IP, attempt
count, window, severity, SOP, reasoning, confidence, and the action taken.

- **Memory:** hindsight (knowledge graph of incidents over time).
- **Writes:** `ssh_audit_log`.
