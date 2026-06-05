# Bastion — SSH Perimeter Guard

Primary agent of the Space Armour perimeter crew. Aggregates SSH attempts per
source IP, detects brute-force bursts (> 5 / 60s), reasons over each with glm-5
grounded in the SSH SOP, and orders a 1-hour block. Detect-and-enforce.

- **Memory:** mem0 (cross-incident operational recall).
- **Reads:** `ssh_events`; `bastion_sops` knowledge base (pgvector).
- **Writes:** `ssh_audit_log`; orders blocks via Warden; mirrors incidents into Hindsight.
- **Safety:** never blocks whitelisted IPs (monitoring path, admin, internal VPC).
