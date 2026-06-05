#!/usr/bin/env bash
# ============================================================
# Run this ONCE on the TARGET server (space-armour-server) to enable Bastion's
# enforcement. It installs ipset, creates the timed block set, wires a single
# standing iptables rule that drops anything in the set, and grants the probe
# user passwordless sudo for exactly the ipset/iptables commands Bastion uses.
#
#   sudo bash target_setup.sh [probe_user]
#
# probe_user defaults to the current SUDO_USER / $USER.
# ============================================================
set -euo pipefail

SET_NAME="${BASTION_IPSET_NAME:-bastion_block}"
PROBE_USER="${1:-${SUDO_USER:-$USER}}"

echo "[bastion] installing ipset..."
if command -v apt-get >/dev/null 2>&1; then
  apt-get update -qq && apt-get install -y -qq ipset iptables
elif command -v yum >/dev/null 2>&1; then
  yum install -y -q ipset iptables
fi

echo "[bastion] creating ipset '$SET_NAME' (hash:ip, supports per-entry timeout)..."
ipset create "$SET_NAME" hash:ip timeout 0 -exist

echo "[bastion] inserting standing iptables DROP rule for the set (idempotent)..."
# Drop new SSH connections from any IP currently in the set. Inserted at the top
# of INPUT so it wins. ipset's per-entry timeout removes IPs after 1h.
if ! iptables -C INPUT -m set --match-set "$SET_NAME" src -p tcp --dport 22 -j DROP 2>/dev/null; then
  iptables -I INPUT 1 -m set --match-set "$SET_NAME" src -p tcp --dport 22 -j DROP
fi

echo "[bastion] granting '$PROBE_USER' passwordless sudo for ipset/iptables..."
SUDOERS=/etc/sudoers.d/bastion
cat > "$SUDOERS" <<EOF
# Allow Bastion's probe user to manage the SSH block set only.
$PROBE_USER ALL=(root) NOPASSWD: /usr/sbin/ipset, /sbin/ipset, /usr/sbin/iptables, /sbin/iptables
EOF
chmod 440 "$SUDOERS"
visudo -cf "$SUDOERS"

echo "[bastion] done. Set='$SET_NAME', rule active, sudo granted to '$PROBE_USER'."
echo "[bastion] NOTE: iptables/ipset rules are not persistent across reboot by"
echo "          default — install iptables-persistent + ipset-persistent, or"
echo "          re-run this script on boot, to survive a restart."
