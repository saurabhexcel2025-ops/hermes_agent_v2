#!/usr/bin/env python3
"""Enforce one Bastion block — called by the Bastion agent after it assesses a
THREAT. Reads a JSON object from stdin (or argv[1]):

  {
    "src_ip": str, "attempts": int, "severity": "WARN"|"CRITICAL",
    "target": str, "sop_ref": str, "reasoning": str, "confidence": number
  }

SAFETY: this script RE-VALIDATES before doing anything destructive — it
re-counts the IP's attempts in the window, re-checks the whitelist, and skips if
already blocked. So even if the agent misjudges, a block only happens when the
deterministic rule still holds. On success it adds the ipset entry + VPC firewall
DENY, then writes ssh_audit_log + ssh_blocks and mirrors Hindsight.
"""

from __future__ import annotations

import json
import os
import sys
import urllib.request

sys.path.insert(0, os.path.expanduser("~/.hermes/scripts"))
import bastion_lib as L  # noqa: E402

AUDIT_INSERT = """
INSERT INTO ssh_audit_log
  (target, src_ip, attempt_count, window_seconds, severity, sop_ref,
   reasoning, confidence, action_taken)
VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id
"""
BLOCK_INSERT = """
INSERT INTO ssh_blocks
  (src_ip, target, expires_at, attempt_count, reason, audit_id)
VALUES (%s, %s, now() + (%s || ' seconds')::interval, %s, %s, %s)
"""


def retain_hindsight(ip: str, attempts: int, severity: str, summary: str) -> None:
    try:
        url = os.environ.get("HINDSIGHT_BASE_URL", "http://host.docker.internal:9177")
        org = os.environ.get("HINDSIGHT_ORG", "default")
        bank = os.environ.get("HINDSIGHT_BANK_ID", "hermes")
        text = (f"SSH brute-force from {ip}: {attempts} attempts in "
                f"{L.WINDOW_SECONDS}s ({severity}). Blocked {L.BLOCK_SECONDS}s. {summary}")
        tags = ["bastion", "ssh", "block", severity.lower()]
        payload = json.dumps({"items": [{"content": text, "tags": tags}],
                              "document_tags": tags, "async": True}).encode()
        req = urllib.request.Request(f"{url}/v1/{org}/banks/{bank}/memories",
                                     data=payload, headers={"Content-Type": "application/json"})
        urllib.request.urlopen(req, timeout=15).read()
    except Exception as exc:
        print(f"warn: hindsight retain skipped: {exc}", file=sys.stderr)


def main() -> int:
    raw = sys.argv[1] if len(sys.argv) > 1 else sys.stdin.read()
    d = json.loads(raw)
    ip = d["src_ip"]
    conn = L.connect()

    # ── RE-VALIDATION GUARDS (defend against an LLM misfire) ────────────────
    if L.is_whitelisted(ip):
        print(f"REFUSED: {ip} is whitelisted — not blocking.")
        return 0
    if L.already_blocked(conn, ip):
        print(f"NOOP: {ip} already has an active block.")
        return 0
    live = L.count_attempts(conn, ip)
    if live <= L.ATTEMPTS:
        print(f"REFUSED: {ip} now at {live} attempts in {L.WINDOW_SECONDS}s "
              f"(<= threshold {L.ATTEMPTS}) — no longer actionable.")
        return 0

    severity = L.severity_for(live)
    ipset_ok, ipset_action = L.ipset_block(ip)
    vpc_ok, vpc_action = L.vpc_block(ip)
    blocked = ipset_ok or vpc_ok
    action_taken = " | ".join([ipset_action if ipset_ok else f"FAILED: {ipset_action}", vpc_action])

    with conn.cursor() as cur:
        cur.execute(AUDIT_INSERT, (
            d.get("target"), ip, live, L.WINDOW_SECONDS, severity,
            d.get("sop_ref"), d.get("reasoning"), d.get("confidence"), action_taken))
        audit_id = cur.fetchone()[0]
        if blocked:
            cur.execute(BLOCK_INSERT, (
                ip, d.get("target"), L.BLOCK_SECONDS, live,
                d.get("reasoning") or f"{live} attempts in {L.WINDOW_SECONDS}s", audit_id))

    retain_hindsight(ip, live, severity, d.get("reasoning") or "")
    status = "BLOCKED" if blocked else "DETECTED(block-failed)"
    print(f"{status} {ip} — {live} attempts ({severity}); ipset={ipset_ok} vpc={vpc_ok}; "
          f"audit_id={audit_id}; expires in {L.BLOCK_SECONDS}s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
