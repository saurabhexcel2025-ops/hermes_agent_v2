#!/usr/bin/env bash
# ============================================================
# Bastion demo trigger — fire a burst of SSH attempts at the target so Bastion
# detects the brute-force, reasons over it, and blocks the source IP for 1 hour.
#
#   ./brute_force.sh <target_host> [attempts] [port]
#
# Defaults: 12 attempts on port 22 (> the >5/60s threshold).
#
# ⚠️  Run this from a NON-WHITELISTED IP (i.e. NOT mission-control-one and NOT
#     your admin box). The whitelist covers all private ranges + your admin IP,
#     so a whitelisted source is (correctly) ignored and nothing will trigger.
#     Use a separate VM / Cloud Shell / different network as the attacker.
#
# It uses sshpass with a junk password if available, otherwise plain ssh with a
# short timeout — either way each connection is a logged attempt. No real login
# happens; we only need sshd to record the attempts.
# ============================================================
set -uo pipefail

HOST="${1:?usage: brute_force.sh <target_host> [attempts] [port]}"
ATTEMPTS="${2:-12}"
PORT="${3:-22}"
USER="bastion-demo-$RANDOM"

echo "[brute] firing $ATTEMPTS SSH attempts at $HOST:$PORT as bogus user '$USER'"
for i in $(seq 1 "$ATTEMPTS"); do
  if command -v sshpass >/dev/null 2>&1; then
    sshpass -p "wrong-$i" ssh -p "$PORT" \
      -o StrictHostKeyChecking=no -o ConnectTimeout=5 \
      -o PreferredAuthentications=password -o PubkeyAuthentication=no \
      "${USER}@${HOST}" exit 2>/dev/null || true
  else
    ssh -p "$PORT" \
      -o StrictHostKeyChecking=no -o ConnectTimeout=5 -o BatchMode=yes \
      "${USER}@${HOST}" exit 2>/dev/null || true
  fi
  echo "  attempt $i/$ATTEMPTS"
done
echo "[brute] done — watch the Perimeter Ops page; this IP should get blocked."
