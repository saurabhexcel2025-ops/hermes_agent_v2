#!/usr/bin/env python3
"""Bastion pre-processing script (Hermes-native).

Runs as the `--script` of the Bastion cron routine. Each tick it:
  1. Reads recent sshd events from the target and writes them to `ssh_events`
     (idempotent via raw_hash) — Gatekeeper's job.
  2. Sweeps expired blocks: deletes the VPC firewall rule + ipset entry and
     marks `released_at` (VPC rules have no TTL, so the routine handles expiry).
  3. Aggregates attempts per source IP over the trailing window. Any IP over the
     threshold that is NOT whitelisted and NOT already blocked is surfaced as a
     THREAT packet (with the SSH SOP) for the Bastion agent to assess + block.
  4. Prints `[SILENT]` if there is nothing to act on.

Detection here is deterministic; the agent decides + enforces via the
bastion-guard skill, whose enforce_block.py RE-VALIDATES before acting.
"""

from __future__ import annotations

import json
import os
import sys

# Reuse the existing daemon's log parser (probe.read_events) so parsing stays
# identical, plus the shared lib for everything else.
sys.path.insert(0, os.path.expanduser("~/.hermes/scripts"))
import bastion_lib as L  # noqa: E402

# The daemon's probe.py lives in the repo; import its read_events for parsing.
_REPO_BASTION = os.environ.get(
    "BASTION_REPO_DIR",
    os.path.join(os.path.dirname(__file__), "..", "..", "bastion"),
)
sys.path.insert(0, os.path.abspath(_REPO_BASTION))
from probe import read_events  # noqa: E402

INSERT = """
INSERT INTO ssh_events
  (event_ts, target, src_ip, username, result, raw, raw_hash)
VALUES
  (CASE WHEN %(event_unix)s > 0 THEN to_timestamp(%(event_unix)s) ELSE now() END,
   %(target)s, %(src_ip)s, %(username)s, %(result)s, %(raw)s, %(raw_hash)s)
ON CONFLICT (raw_hash) DO NOTHING
"""
OFFENDERS = """
SELECT src_ip, COUNT(*) AS attempts
FROM ssh_events
WHERE event_ts > now() - (%s || ' seconds')::interval
GROUP BY src_ip HAVING COUNT(*) > %s
ORDER BY attempts DESC
"""
EXPIRED = "SELECT id, src_ip FROM ssh_blocks WHERE released_at IS NULL AND expires_at <= now()"
RELEASE = "UPDATE ssh_blocks SET released_at = now() WHERE id = %s"


def load_sop() -> tuple[str, str]:
    path = os.path.join(_REPO_BASTION, "sop", "ssh-brute-force.md")
    try:
        with open(path, encoding="utf-8") as fh:
            return "ssh-brute-force", fh.read()
    except OSError:
        return "ssh-brute-force", ""


def sweep_expired(conn) -> None:
    with conn.cursor() as cur:
        cur.execute(EXPIRED)
        rows = cur.fetchall()
    for block_id, ip in rows:
        L.ipset_unblock(ip)
        if L.vpc_enabled():
            L.vpc_unblock(ip)
        with conn.cursor() as cur:
            cur.execute(RELEASE, (block_id,))


def main() -> int:
    conn = L.connect()

    # 1. Ingest fresh SSH attempts.
    try:
        with conn.cursor() as cur:
            for ev in read_events():
                cur.execute(INSERT, ev)
    except Exception as exc:
        print(f"[SILENT] (ingest error: {exc})")
        return 0

    # 2. Expire old blocks.
    sweep_expired(conn)

    # 3. Find actionable offenders.
    with conn.cursor() as cur:
        cur.execute(OFFENDERS, (L.WINDOW_SECONDS, L.ATTEMPTS))
        rows = cur.fetchall()

    threats = []
    for ip, attempts in rows:
        if L.is_whitelisted(ip) or L.already_blocked(conn, ip):
            continue
        threats.append({
            "src_ip": ip, "attempts": int(attempts),
            "window_seconds": L.WINDOW_SECONDS, "threshold": L.ATTEMPTS,
            "severity": L.severity_for(int(attempts)),
            "target": os.environ.get("BASTION_TARGET_HOST") or "localhost",
            "sop_ref": "ssh-brute-force",
        })

    if not threats:
        print("[SILENT]")
        return 0

    sop_ref, sop_body = load_sop()
    print("=== BASTION THREATS ===")
    print(json.dumps(threats, indent=2))
    print("\n--- Relevant SOP ---\n" + sop_body)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:
        print(f"[SILENT] (bastion_probe error: {exc})")
        sys.exit(0)
