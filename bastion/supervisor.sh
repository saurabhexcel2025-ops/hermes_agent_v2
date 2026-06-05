#!/usr/bin/env bash
# Starts the Bastion daemons INSIDE the existing mem0-server container, in the
# background, then RETURNS (it does NOT exec). The compose command runs this
# first and then hands off to sentinel/supervisor.sh which execs the mem0 server
# as the container's main process.
#
# The bastion/ dir is bind-mounted at /data/bastion.
set -uo pipefail

cd /data/bastion

echo "[bastion-supervisor] starting Bastion collector + cycle"
python collector.py     >> /proc/1/fd/1 2>&1 &
python bastion_cycle.py >> /proc/1/fd/1 2>&1 &

echo "[bastion-supervisor] daemons backgrounded"
