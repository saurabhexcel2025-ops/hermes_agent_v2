# Warden — Perimeter Enforcer

Applies and tracks the SSH blocks Bastion orders. Adds the source IP to the
`bastion_block` ipset with a 1-hour timeout (a standing iptables rule drops the
set); ipset auto-expires the entry. Backed operationally by `bastion_cycle.py`.

- **Memory:** mem0.
- **Acts on:** the target firewall (ipset / iptables) over SSH.
- **Writes:** `ssh_blocks` table (active + historical blocks with expiry).
