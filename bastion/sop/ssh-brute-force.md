# SOP-101 — SSH Brute-Force / Login Abuse

**Surface:** Remote access / SSH (port 22)
**Trigger:** More than 5 SSH login attempts from a single source IP within 60
seconds.

## Meaning
A burst of SSH attempts from one address in a short window is the signature of a
credential brute-force or password-spray. A legitimate user does not generate
this volume; automated tooling (hydra, ncrack, medusa, botnets) does. Left
unchecked it ties up sshd, fills the auth log, and risks credential compromise.

## Detection procedure
1. Aggregate sshd auth/connection events per source IP over the trailing 60s.
2. Confirm the IP is over the threshold (> 5 attempts) and is NOT on the trusted
   whitelist (monitoring path, admin IPs, internal VPC ranges).
3. Note the attempt count, the usernames targeted, and the result mix
   (failed / invalid-user / pre-auth disconnects vs. accepted).

## Response
1. Block the offending IP at the host: add it to the `bastion_block` ipset with a
   time-boxed timeout (the configured block duration). A standing iptables rule
   drops all traffic matching the set, so SSH from that IP is refused, after which
   ipset expires the entry automatically.
2. Block the offending IP at the network edge: create a VPC INGRESS DENY firewall
   rule for the `/32` on tcp:22 (priority above the allow-ssh rule), so the IP is
   dropped before it reaches the VM. The rule is removed when the block expires.
3. Seal an audit-trail entry: source IP, attempt count, window, severity, the
   SOP referenced, the model's reasoning, confidence, and the exact action
   taken.
4. Do NOT block whitelisted IPs under any circumstances — the monitoring probe
   itself connects over SSH and must never be locked out.

## What to log
- Source IP and attempt count in the window.
- Severity (WARN, or CRITICAL at >= 2x the threshold).
- The block action and its expiry.

## Notes
Enforcement is automatic and time-boxed to the configured block duration, applied
at both the host (ipset) and the VPC network edge (firewall). Repeat offenders
re-trip the rule on their next burst after the block expires.
