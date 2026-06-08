#!/usr/bin/env python3
"""Seal one Sentinel incident: write the audit_log row + mirror to Hindsight.

Called by the Sentinel agent after it has reasoned about an INCIDENT packet.
Reads a JSON object from stdin (or argv[1]) with the agent's conclusions:

  {
    "target": str, "anomaly": str, "severity": "WARN"|"CRITICAL",
    "culprit_proc": str|null, "culprit_pid": int|null, "culprit_cpu": float|null,
    "sop_ref": str|null, "reasoning": str, "confidence": number,
    "telemetry_id": int
  }

Detect-and-log only — no remediation. mem0 is handled natively by the sentinel
profile's memory provider, so this only covers the audit row + Hindsight graph.
"""

from __future__ import annotations

import json
import os
import sys
import urllib.request

import psycopg2

AUDIT_INSERT = """
INSERT INTO audit_log
  (target, anomaly, severity, culprit_proc, culprit_pid, culprit_cpu,
   sop_ref, reasoning, confidence, telemetry_id)
VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
RETURNING id
"""


def dsn() -> str:
    url = os.environ.get("DATABASE_URL")
    if url:
        return url
    return (f"host={os.environ.get('POSTGRES_HOST', 'postgres')} "
            f"port={os.environ.get('POSTGRES_PORT', '5432')} "
            f"dbname={os.environ.get('POSTGRES_DB', 'hermes_auth')} "
            f"user={os.environ.get('POSTGRES_USER', 'hermes')} "
            f"password={os.environ.get('POSTGRES_PASSWORD', '')}")


def retain_hindsight(d: dict) -> None:
    try:
        url = os.environ.get("HINDSIGHT_BASE_URL", "http://host.docker.internal:9177")
        org = os.environ.get("HINDSIGHT_ORG", "default")
        bank = os.environ.get("HINDSIGHT_BANK_ID", "hermes")
        text = (f"Incident on {d.get('target')}: {d.get('severity')} — "
                f"{d.get('anomaly')}; process {d.get('culprit_proc')} "
                f"(pid {d.get('culprit_pid')}). {d.get('reasoning')}")
        tags = ["sentinel", "incident", str(d.get("severity", "")).lower()]
        payload = json.dumps({
            "items": [{"content": text, "tags": tags}],
            "document_tags": tags, "async": True,
        }).encode()
        req = urllib.request.Request(
            f"{url}/v1/{org}/banks/{bank}/memories",
            data=payload, headers={"Content-Type": "application/json"})
        urllib.request.urlopen(req, timeout=15).read()
    except Exception as exc:
        print(f"warn: hindsight retain skipped: {exc}", file=sys.stderr)


def main() -> int:
    raw = sys.argv[1] if len(sys.argv) > 1 else sys.stdin.read()
    d = json.loads(raw)

    conn = psycopg2.connect(dsn())
    conn.autocommit = True
    with conn.cursor() as cur:
        cur.execute(AUDIT_INSERT, (
            d.get("target"), d.get("anomaly"), d.get("severity"),
            d.get("culprit_proc"), d.get("culprit_pid"), d.get("culprit_cpu"),
            d.get("sop_ref"), d.get("reasoning"), d.get("confidence"),
            d.get("telemetry_id"),
        ))
        audit_id = cur.fetchone()[0]
    retain_hindsight(d)
    print(f"sealed audit_log id={audit_id} ({d.get('severity')} on {d.get('target')})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
