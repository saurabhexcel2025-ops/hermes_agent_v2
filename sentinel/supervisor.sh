#!/usr/bin/env bash
# Runs the Sentinel daemons INSIDE the existing mem0-server container, then
# hands off to the mem0 FastAPI server as the container's main process.
#
# Wired in via docker-compose (mem0-server.command). The sentinel/ dir is
# bind-mounted at /data/sentinel.
set -euo pipefail

cd /data/sentinel

echo "[supervisor] starting Sentinel collector + cycle"
python collector.py      >> /proc/1/fd/1 2>&1 &
python sentinel_cycle.py >> /proc/1/fd/1 2>&1 &

echo "[supervisor] handing off to mem0 server"
exec python /app/server.py
