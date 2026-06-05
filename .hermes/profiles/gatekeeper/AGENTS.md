# Gatekeeper — SSH Access-Log Monitor

Reads the target server's sshd logs (journalctl, with /var/log/auth.log
fallback) every few seconds and records each SSH attempt with its source IP.
Backed operationally by Bastion's `collector.py` daemon.

- **Memory:** mem0.
- **Reads:** target `sshd` logs over SSH.
- **Writes:** `ssh_events` table.
