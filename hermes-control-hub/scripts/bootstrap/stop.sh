#!/usr/bin/env bash
# Stop Control Hub Next.js server (PORT from env, .env.local, or default 42069).
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
CH_SCRIPTS_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# shellcheck source=../lib/ch-env.sh
source "$CH_SCRIPTS_ROOT/lib/ch-env.sh"
# shellcheck source=../lib/ch-dotenv-local.sh
source "$CH_SCRIPTS_ROOT/lib/ch-dotenv-local.sh"

ch_load_control_hub_env_local "$APP_DIR"
ch_stop_control_hub "$APP_DIR"

PORT="${PORT:-}"
if [ -z "$PORT" ] && [ -f "$APP_DIR/.env.local" ]; then
  PORT="$(ch_env_read_port "$APP_DIR/.env.local" 2>/dev/null || true)"
fi
PORT="${PORT:-42069}"
echo "Stopped Control Hub listeners on port $PORT"
