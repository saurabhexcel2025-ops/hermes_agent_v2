#!/usr/bin/env bash
# Starts the Bastion daemons INSIDE the existing mem0-server container, in the
# background, then RETURNS (it does NOT exec). The compose command runs this
# first and then hands off to sentinel/supervisor.sh which execs the mem0 server
# as the container's main process.
#
# The bastion/ dir is bind-mounted at /data/bastion.
set -uo pipefail

cd /data/bastion

# VPC edge enforcement needs google-auth (Compute API token). Install on startup
# if it's enabled and missing, so no image rebuild is required.
if [ "${BASTION_VPC_ENABLE:-false}" = "true" ]; then
  # google.auth.transport.requests needs `requests` too (usually already in the
  # mem0 image via transformers, but install defensively).
  python -c "import google.auth, requests" 2>/dev/null || {
    echo "[bastion-supervisor] installing google-auth + requests for VPC enforcement"
    pip install --quiet --no-cache-dir "google-auth>=2.0.0" requests || \
      echo "[bastion-supervisor] WARN: install failed; VPC enforcement will no-op"
  }
fi

echo "[bastion-supervisor] starting Bastion collector + cycle"
python collector.py     >> /proc/1/fd/1 2>&1 &
python bastion_cycle.py >> /proc/1/fd/1 2>&1 &

echo "[bastion-supervisor] daemons backgrounded"
