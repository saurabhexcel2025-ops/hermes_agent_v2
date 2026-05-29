#!/bin/bash
set -e

# Fix ownership of runtime data directories so nextjs user can write SQLite DB and files.
# Volumes are created by Docker as root — this runs as root to chown before dropping privs.
for dir in "${CH_DATA_DIR:-/data/ch}" "${HERMES_HOME:-/data/hermes}"; do
  if [ -d "$dir" ]; then
    chown -R nextjs:nodejs "$dir" 2>/dev/null || true
  fi
done

exec gosu nextjs "$@"
