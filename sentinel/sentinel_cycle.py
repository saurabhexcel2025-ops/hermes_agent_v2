"""Sentinel cycle — the actor (detect-and-log only, no remediation).

Loop:
  1. Read the latest telemetry row for the target.
  2. On the rising edge into an anomaly (severity NORMAL -> WARN/CRITICAL),
     identify the culprit process (already captured in the telemetry row).
  3. Retrieve the most relevant SOP from pgvector for context.
  4. Ask glm-5 (via the Hermes gateway) for a plain-English summary + confidence.
  5. Write a sealed row to audit_log.  *** No command is executed. ***
  6. Mirror the incident into Hindsight (best-effort) for the knowledge graph.
     mem0 is updated automatically by the sentinel profile's memory provider.
"""

from __future__ import annotations

import json
import logging
import os
import time
import urllib.request

from db import connect
from embeddings import embed, to_pgvector

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s sentinel.cycle %(levelname)s %(message)s",
)
log = logging.getLogger(__name__)

POLL = int(os.environ.get("SENTINEL_CYCLE_SECONDS", "5"))
GATEWAY_URL = os.environ.get("HERMES_GATEWAY_URL", "http://host.docker.internal:8642")
GATEWAY_KEY = os.environ.get("HERMES_GATEWAY_API_KEY", "")
MODEL = os.environ.get("SENTINEL_MODEL", "glm-5")
HINDSIGHT_URL = os.environ.get("HINDSIGHT_BASE_URL", "http://host.docker.internal:9177")
HINDSIGHT_BANK = os.environ.get("HINDSIGHT_BANK_ID", "hermes")
HINDSIGHT_ORG = os.environ.get("HINDSIGHT_ORG", "default")

SYSTEM_PROMPT = (
    "You are Sentinel, an autonomous spacecraft operations monitor. You watch "
    "live satellite telemetry, detect anomalies, and explain them grounded in "
    "the Standard Operating Procedure provided. You DO NOT take any corrective "
    "action — you observe, identify the responsible subsystem/process, and "
    "report. Respond ONLY with strict JSON: "
    '{"summary": str, "culprit_process": str, "sop_ref": str, "confidence": number}'
)

LATEST = """
SELECT id, target, processor_load, ram_saturation, storage_write, downlink,
       uplink, active_subsys, top_proc, top_pid, top_cpu, severity
FROM telemetry ORDER BY id DESC LIMIT 1
"""

AUDIT_INSERT = """
INSERT INTO audit_log
  (target, anomaly, severity, culprit_proc, culprit_pid, culprit_cpu,
   sop_ref, reasoning, confidence, telemetry_id)
VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
"""


def search_sop(conn, anomaly_text: str):
    vec = to_pgvector(embed(anomaly_text))
    with conn.cursor() as cur:
        cur.execute(
            "SELECT id, title, body FROM sops ORDER BY embedding <=> %s::vector LIMIT 1",
            (vec,),
        )
        return cur.fetchone()  # (id, title, body) or None


def reason(snapshot: dict, sop_body: str) -> dict:
    """Call glm-5 via the gateway's OpenAI-compatible endpoint."""
    payload = json.dumps({
        "model": MODEL,
        "temperature": 0.2,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content":
                "Telemetry snapshot:\n" + json.dumps(snapshot, default=str) +
                "\n\nRelevant SOP:\n" + sop_body +
                "\n\nIdentify the anomaly and the culprit process. JSON only."},
        ],
    }).encode()
    req = urllib.request.Request(
        f"{GATEWAY_URL}/v1/chat/completions",
        data=payload,
        headers={"Content-Type": "application/json",
                 "Authorization": f"Bearer {GATEWAY_KEY}"},
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        body = json.loads(resp.read())
    content = body["choices"][0]["message"]["content"]
    try:
        return json.loads(content)
    except json.JSONDecodeError:
        # Be forgiving if the model wraps JSON in prose/fences.
        start, end = content.find("{"), content.rfind("}")
        return json.loads(content[start:end + 1])


def retain_hindsight(snapshot: dict, result: dict) -> None:
    """Best-effort mirror into Hindsight's knowledge graph."""
    try:
        text = (f"Incident on {snapshot['target']}: {snapshot['severity']} — "
                f"process {snapshot.get('top_proc')} (pid {snapshot.get('top_pid')}) "
                f"at {snapshot.get('processor_load')}% CPU. {result.get('summary')}")
        tags = ["sentinel", "incident", snapshot["severity"].lower()]
        # Hindsight retain endpoint: POST /v1/{org}/banks/{bank}/memories with a
        # RetainRequest body ({items:[{content,tags}], document_tags, async}).
        payload = json.dumps({
            "items": [{"content": text, "tags": tags}],
            "document_tags": tags,
            "async": True,
        }).encode()
        req = urllib.request.Request(
            f"{HINDSIGHT_URL}/v1/{HINDSIGHT_ORG}/banks/{HINDSIGHT_BANK}/memories",
            data=payload, headers={"Content-Type": "application/json"})
        urllib.request.urlopen(req, timeout=15).read()
    except Exception as exc:  # never let memory mirroring break the cycle
        log.warning("hindsight retain skipped: %s", exc)


def main() -> None:
    conn = connect()
    log.info("cycle started — model=%s gateway=%s", MODEL, GATEWAY_URL)
    prev_severity = "NORMAL"
    while True:
        try:
            with conn.cursor() as cur:
                cur.execute(LATEST)
                row = cur.fetchone()
            if row:
                cols = ["id", "target", "processor_load", "ram_saturation",
                        "storage_write", "downlink", "uplink", "active_subsys",
                        "top_proc", "top_pid", "top_cpu", "severity"]
                snap = dict(zip(cols, row))
                sev = snap["severity"]
                # Rising edge into an anomaly -> run one cycle.
                if sev != "NORMAL" and prev_severity == "NORMAL":
                    anomaly = f"{sev}: CPU {snap['processor_load']}%, top process {snap['top_proc']}"
                    sop = search_sop(conn, anomaly)
                    sop_id, sop_title, sop_body = sop if sop else (None, None, "")
                    result = reason(snap, sop_body or "")
                    with conn.cursor() as cur:
                        cur.execute(AUDIT_INSERT, (
                            snap["target"], anomaly, sev,
                            snap["top_proc"], snap["top_pid"], snap["top_cpu"],
                            sop_id, result.get("summary"),
                            result.get("confidence"), snap["id"],
                        ))
                    log.info("LOGGED %s — %s (conf=%s)", sev,
                             snap["top_proc"], result.get("confidence"))
                    retain_hindsight(snap, result)
                prev_severity = sev
        except Exception:
            log.exception("cycle iteration failed")
            try:
                conn.close()
            except Exception:
                pass
            conn = connect()
        time.sleep(POLL)


if __name__ == "__main__":
    main()
