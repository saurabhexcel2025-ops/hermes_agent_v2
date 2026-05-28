#!/usr/bin/env bash
# Deploy status file for dashboard polling (written by ch-deploy-impl.sh).

CH_DEPLOY_STATUS_FILE="${CH_DEPLOY_STATUS_FILE:-$HOME/.hermes/logs/ch-deploy.status}"

ch_deploy_status_ensure_dir() {
  mkdir -p "$(dirname "$CH_DEPLOY_STATUS_FILE")"
}

# ch_deploy_status_write <state> <action> <phase> <message> [exitCode] [logHint]
ch_deploy_status_write() {
  local state="$1"
  local action="$2"
  local phase="$3"
  local message="$4"
  local exit_code="${5:-}"
  local log_hint="${6:-}"
  local started_at finished_at
  ch_deploy_status_ensure_dir

  if [ "$state" = "running" ]; then
    started_at="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
    finished_at=""
  else
    started_at="$(grep -m1 '^startedAt=' "$CH_DEPLOY_STATUS_FILE" 2>/dev/null | cut -d= -f2- || date -u '+%Y-%m-%dT%H:%M:%SZ')"
    finished_at="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  fi

  local tmp="${CH_DEPLOY_STATUS_FILE}.$$.tmp"
  {
    echo "state=$state"
    echo "action=$action"
    echo "phase=$phase"
    # Strip newlines from message for single-line files
    echo "message=${message//$'\n'/ }"
    echo "startedAt=$started_at"
    echo "finishedAt=$finished_at"
    echo "exitCode=$exit_code"
    echo "logHint=$log_hint"
  } >"$tmp"
  mv -f "$tmp" "$CH_DEPLOY_STATUS_FILE"
}

ch_deploy_status_clear_idle() {
  ch_deploy_status_write "idle" "" "" "Ready" "" ""
}
