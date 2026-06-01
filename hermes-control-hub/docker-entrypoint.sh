#!/bin/bash
set -e

CH_DIR="${CH_DATA_DIR:-/data/ch}"
HERMES_DIR="${HERMES_HOME:-/data/hermes}"

# Default run identity: the baked-in nextjs user.
RUN_UID="$(id -u nextjs)"
RUN_GID="$(id -g nextjs)"

# The Hermes home is bind-mounted read-only from the host and owned by the host
# user, whose uid/gid differs from the container's nextjs user. To read
# config.yaml and the logs/ dir (mode 700) we must run as that same identity,
# so detect the mount owner and adopt it. Falls back to nextjs when the mount
# is absent or root-owned.
if [ -d "$HERMES_DIR" ]; then
  MOUNT_UID="$(stat -c %u "$HERMES_DIR" 2>/dev/null || echo "")"
  MOUNT_GID="$(stat -c %g "$HERMES_DIR" 2>/dev/null || echo "")"
  if [ -n "$MOUNT_UID" ] && [ "$MOUNT_UID" != "0" ]; then
    RUN_UID="$MOUNT_UID"
    RUN_GID="$MOUNT_GID"
  fi
fi

# Writable runtime data (SQLite DB, audit log) must be owned by the run user.
# Volumes are created by Docker as root — this runs as root to chown before
# dropping privileges.
if [ -d "$CH_DIR" ]; then
  chown -R "$RUN_UID:$RUN_GID" "$CH_DIR" 2>/dev/null || true
fi

exec gosu "$RUN_UID:$RUN_GID" "$@"
