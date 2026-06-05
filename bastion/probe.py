"""SSH log probe — reads sshd auth/connection events from the target server.

Two layers:
  - ssh_exec(cmd)   : run an arbitrary command on the target over SSH. Shared by
                      the collector (read logs) and the cycle (apply the block).
  - read_events()   : pull recent sshd log lines from the target and parse them
                      into structured attempts (src_ip, username, result).

Log source is auto-detected on the target: journalctl (_COMM=sshd) is preferred
because it yields reliable unix timestamps; /var/log/auth.log is the fallback.

If BASTION_TARGET_HOST is unset, runs against the LOCAL host (dev/testing).
"""

from __future__ import annotations

import hashlib
import os
import re
import shlex
import subprocess

# Look back a little further than the detection window so nothing is missed
# between polls; raw_hash dedup makes the overlap idempotent.
LOOKBACK = int(os.environ.get("BASTION_LOOKBACK_SECONDS", "90"))

# One portable script: prefer journalctl, fall back to auth.log. Emits one line
# per sshd log entry, prefixed with a unix timestamp we can trust:
#   <unix_ts> <raw sshd message line>
REMOTE_READ = r"""
LB="__LOOKBACK__"
if command -v journalctl >/dev/null 2>&1; then
  since=$(date -d "-${LB} seconds" '+%Y-%m-%d %H:%M:%S' 2>/dev/null || date '+%Y-%m-%d %H:%M:%S')
  journalctl _COMM=sshd --since "$since" -o short-unix --no-pager 2>/dev/null
elif [ -r /var/log/auth.log ]; then
  # Fallback: recent sshd lines; no reliable per-line unix ts, so emit 0 and let
  # the collector stamp ingest time (dedup still prevents recounting old lines).
  grep -a 'sshd' /var/log/auth.log 2>/dev/null | tail -n 500 | sed 's/^/0 /'
fi
"""

# sshd message patterns -> (result). Each matched line counts as one attempt.
# Order matters: most specific first. IP is captured group "ip".
_IP = r"(?P<ip>\d{1,3}(?:\.\d{1,3}){3}|[0-9a-fA-F:]+)"
PATTERNS: list[tuple[re.Pattern, str]] = [
    (re.compile(rf"Accepted \S+ for (?P<user>\S+) from {_IP}"), "accepted"),
    (re.compile(rf"Failed password for invalid user (?P<user>\S+) from {_IP}"), "invalid"),
    (re.compile(rf"Failed password for (?P<user>\S+) from {_IP}"), "failed"),
    (re.compile(rf"Invalid user (?P<user>\S+) from {_IP}"), "invalid"),
    (re.compile(rf"Connection (?:closed|reset) by (?:authenticating|invalid) user (?P<user>\S+) {_IP}"), "preauth"),
    (re.compile(rf"Connection (?:closed|reset) by {_IP} port \d+ \[preauth\]"), "preauth"),
    (re.compile(rf"Disconnected from (?:authenticating|invalid) user (?P<user>\S+) {_IP}"), "preauth"),
]


def _ssh_base_cmd() -> list[str] | None:
    """SSH command prefix for the target, or None to run locally."""
    host = os.environ.get("BASTION_TARGET_HOST")
    if not host:
        return None
    user = os.environ.get("BASTION_TARGET_USER", "root")
    key = os.environ.get("BASTION_SSH_KEY")
    port = os.environ.get("BASTION_TARGET_PORT", "22")
    cmd = ["ssh", "-p", port,
           "-o", "StrictHostKeyChecking=accept-new",
           "-o", "ConnectTimeout=10",
           "-o", "BatchMode=yes"]
    if key:
        cmd += ["-i", key]
    cmd += [f"{user}@{host}"]
    return cmd


def ssh_exec(remote_cmd: str, timeout: int = 30) -> tuple[int, str, str]:
    """Run a command on the target (or locally if no target host). Returns
    (returncode, stdout, stderr)."""
    base = _ssh_base_cmd()
    if base is None:
        cmd = ["bash", "-c", remote_cmd]
    else:
        cmd = base + [f"bash -c {shlex.quote(remote_cmd)}"]
    out = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    return out.returncode, out.stdout, out.stderr


def _parse_line(unix_ts: str, msg: str, target: str) -> dict | None:
    for pat, result in PATTERNS:
        m = pat.search(msg)
        if not m:
            continue
        ip = m.group("ip")
        # Ignore obvious noise / loopback.
        if not ip or ip in ("0.0.0.0", "::1", "127.0.0.1"):
            return None
        user = m.groupdict().get("user")
        try:
            ts = float(unix_ts)
        except ValueError:
            ts = 0.0
        raw = msg.strip()
        raw_hash = hashlib.sha1(f"{unix_ts}|{raw}".encode()).hexdigest()
        return {
            "event_unix": ts,        # 0 => collector stamps now()
            "target": target,
            "src_ip": ip,
            "username": user,
            "result": result,
            "raw": raw[:500],
            "raw_hash": raw_hash,
        }
    return None


def read_events() -> list[dict]:
    """Return parsed SSH attempts seen on the target in the last LOOKBACK secs."""
    script = REMOTE_READ.replace("__LOOKBACK__", str(LOOKBACK))
    rc, out, err = ssh_exec(script, timeout=30)
    if rc != 0 and not out:
        raise RuntimeError(f"log read failed: {err.strip() or 'no output'}")
    target = os.environ.get("BASTION_TARGET_HOST") or "localhost"
    events: list[dict] = []
    for line in out.splitlines():
        line = line.strip()
        if not line:
            continue
        # short-unix / fallback both lead with "<ts> <message...>"
        parts = line.split(" ", 1)
        if len(parts) != 2:
            continue
        ev = _parse_line(parts[0], parts[1], target)
        if ev:
            events.append(ev)
    return events
