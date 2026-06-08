"""Bastion cycle — the actor (detect, reason, BLOCK).

Unlike Sentinel (detect-and-log only), Bastion enforces. Loop:
  1. Aggregate ssh_events per source IP over the last WINDOW_SECONDS.
  2. For any IP with > ATTEMPTS attempts that is NOT whitelisted and NOT already
     blocked: retrieve the most relevant SOP (pgvector) and ask glm-5 for a
     plain-English summary + confidence.
  3. Apply the block two ways:
       - ipset add bastion_block <ip> timeout BLOCK_SECONDS on the target (a
         single persistent iptables rule drops anything in the set; ipset's
         per-entry timeout auto-expires it).
       - a VPC edge firewall DENY rule for <ip>/32 on tcp:22 (best-effort,
         additive). VPC rules have no TTL, so step 6 sweeps them.
  4. Record the decision in ssh_audit_log and the block in ssh_blocks.
  5. Mirror the incident into Hindsight (best-effort).
  6. Sweep expired blocks: delete the VPC rule (+ ipset entry) and mark released.
"""

from __future__ import annotations

import json
import logging
import os
import time
import urllib.request

from db import connect
from embeddings import embed, to_pgvector
from probe import ssh_exec
from thresholds import ATTEMPTS, WINDOW_SECONDS, BLOCK_SECONDS, severity_for
from vpc_block import enabled as vpc_enabled, vpc_block, vpc_unblock
from whitelist import is_whitelisted

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s bastion.cycle %(levelname)s %(message)s",
)
log = logging.getLogger(__name__)

POLL = int(os.environ.get("BASTION_CYCLE_SECONDS", "5"))
GATEWAY_URL = os.environ.get("HERMES_GATEWAY_URL", "http://host.docker.internal:8642")
GATEWAY_KEY = os.environ.get("HERMES_GATEWAY_API_KEY", "")
MODEL = os.environ.get("BASTION_MODEL", "glm-5")
HINDSIGHT_URL = os.environ.get("HINDSIGHT_BASE_URL", "http://host.docker.internal:9177")
HINDSIGHT_BANK = os.environ.get("HINDSIGHT_BANK_ID", "hermes")
HINDSIGHT_ORG = os.environ.get("HINDSIGHT_ORG", "default")

IPSET_NAME = os.environ.get("BASTION_IPSET_NAME", "bastion_block")
# Where the actual blocking happens. ipset timeout = ttl in seconds. The sudo
# prefix is configurable so the target user can be granted exactly this.
SUDO = os.environ.get("BASTION_SUDO", "sudo")

SYSTEM_PROMPT = (
    "You are Bastion, an autonomous SSH perimeter guard. You watch live SSH "
    "login activity and identify source IPs mounting brute-force / abusive "
    "login bursts against the protected server, grounded in the Standard "
    "Operating Procedure provided. You explain the threat plainly. Respond "
    "ONLY with strict JSON: "
    '{"summary": str, "sop_ref": str, "confidence": number}'
)

AGGREGATE = """
SELECT src_ip, COUNT(*) AS attempts, MAX(event_ts) AS last_ts
FROM ssh_events
WHERE event_ts > now() - (%s || ' seconds')::interval
GROUP BY src_ip
HAVING COUNT(*) > %s
ORDER BY attempts DESC
"""

ALREADY_BLOCKED = """
SELECT 1 FROM ssh_blocks
WHERE src_ip = %s AND released_at IS NULL AND expires_at > now()
LIMIT 1
"""

AUDIT_INSERT = """
INSERT INTO ssh_audit_log
  (target, src_ip, attempt_count, window_seconds, severity, sop_ref,
   reasoning, confidence, action_taken)
VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)
RETURNING id
"""

BLOCK_INSERT = """
INSERT INTO ssh_blocks
  (src_ip, target, expires_at, attempt_count, reason, audit_id)
VALUES (%s, %s, now() + (%s || ' seconds')::interval, %s, %s, %s)
"""

EXPIRED = """
SELECT id, src_ip FROM ssh_blocks
WHERE released_at IS NULL AND expires_at <= now()
"""

RELEASE = "UPDATE ssh_blocks SET released_at = now() WHERE id = %s"


def search_sop(conn, text: str):
    vec = to_pgvector(embed(text))
    with conn.cursor() as cur:
        cur.execute(
            "SELECT id, title, body FROM bastion_sops ORDER BY embedding <=> %s::vector LIMIT 1",
            (vec,),
        )
        return cur.fetchone()  # (id, title, body) or None


def reason(ip: str, attempts: int, sop_body: str) -> dict:
    """Call glm-5 via the gateway's OpenAI-compatible endpoint."""
    snapshot = {
        "src_ip": ip, "attempts": attempts,
        "window_seconds": WINDOW_SECONDS, "threshold": ATTEMPTS,
    }
    payload = json.dumps({
        "model": MODEL,
        "temperature": 0.2,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content":
                "SSH attempt burst:\n" + json.dumps(snapshot) +
                "\n\nRelevant SOP:\n" + sop_body +
                "\n\nAssess the threat and recommend context. JSON only."},
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
        start, end = content.find("{"), content.rfind("}")
        return json.loads(content[start:end + 1])


def apply_block(ip: str) -> tuple[bool, str]:
    """Add the IP to the ipset with a TTL. Returns (ok, action_string)."""
    action = f"{SUDO} ipset add {IPSET_NAME} {ip} timeout {BLOCK_SECONDS} -exist"
    try:
        rc, out, err = ssh_exec(action, timeout=20)
        if rc != 0:
            log.error("ipset add failed for %s: %s", ip, err.strip() or out.strip())
            return False, action
        return True, action
    except Exception:
        log.exception("ipset add raised for %s", ip)
        return False, action


def retain_hindsight(ip: str, attempts: int, severity: str, summary: str) -> None:
    try:
        text = (f"SSH brute-force from {ip}: {attempts} attempts in "
                f"{WINDOW_SECONDS}s ({severity}). Blocked for {BLOCK_SECONDS}s. {summary}")
        tags = ["bastion", "ssh", "block", severity.lower()]
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
    except Exception as exc:
        log.warning("hindsight retain skipped: %s", exc)


def handle(conn, ip: str, attempts: int) -> None:
    # 1. Never touch a whitelisted IP (monitoring path + admin + internal VPC).
    if is_whitelisted(ip):
        return
    # 2. Don't re-block something already under an active block.
    with conn.cursor() as cur:
        cur.execute(ALREADY_BLOCKED, (ip,))
        if cur.fetchone():
            return

    severity = severity_for(attempts)
    target = os.environ.get("BASTION_TARGET_HOST") or "localhost"
    descriptor = f"{attempts} SSH attempts from {ip} in {WINDOW_SECONDS}s ({severity})"

    sop = search_sop(conn, descriptor)
    sop_id, _sop_title, sop_body = sop if sop else (None, None, "")

    try:
        result = reason(ip, attempts, sop_body or "")
    except Exception:
        log.exception("reasoning failed for %s — blocking anyway", ip)
        result = {"summary": descriptor, "sop_ref": sop_id, "confidence": None}

    # Enforce at the host (ipset) AND, if configured, at the VPC edge (firewall).
    # Either succeeding counts as a block; both actions are recorded for audit.
    ok, action = apply_block(ip)
    vpc_ok, vpc_action = vpc_block(ip)
    blocked = ok or vpc_ok
    action_taken = " | ".join([
        action if ok else f"FAILED: {action}",
        vpc_action,
    ])

    with conn.cursor() as cur:
        cur.execute(AUDIT_INSERT, (
            target, ip, attempts, WINDOW_SECONDS, severity,
            result.get("sop_ref") or sop_id, result.get("summary"),
            result.get("confidence"), action_taken,
        ))
        audit_id = cur.fetchone()[0]
        if blocked:
            cur.execute(BLOCK_INSERT, (
                ip, target, BLOCK_SECONDS, attempts,
                result.get("summary") or descriptor, audit_id,
            ))

    log.info("%s %s — %d attempts (conf=%s) [ipset=%s vpc=%s]",
             "BLOCKED" if blocked else "DETECTED(block-failed)", ip, attempts,
             result.get("confidence"), ok, vpc_ok)
    retain_hindsight(ip, attempts, severity, result.get("summary") or "")


def sweep_expired(conn) -> None:
    """Release blocks whose TTL has passed. ipset entries auto-expire, but VPC
    firewall rules have no TTL — so we delete the rule here and mark released.
    The ipset entry is also removed explicitly (best-effort) to stay tidy."""
    with conn.cursor() as cur:
        cur.execute(EXPIRED)
        rows = cur.fetchall()
    for block_id, ip in rows:
        try:
            ssh_exec(f"{SUDO} ipset del {IPSET_NAME} {ip} -exist", timeout=15)
        except Exception:
            log.exception("ipset del raised for %s", ip)
        if vpc_enabled():
            vpc_unblock(ip)
        with conn.cursor() as cur:
            cur.execute(RELEASE, (block_id,))
        log.info("RELEASED %s (block %d expired)", ip, block_id)


def main() -> None:
    conn = connect()
    log.info("cycle started — model=%s gateway=%s threshold=>%d/%ds block=%ds vpc=%s",
             MODEL, GATEWAY_URL, ATTEMPTS, WINDOW_SECONDS, BLOCK_SECONDS, vpc_enabled())
    while True:
        try:
            with conn.cursor() as cur:
                cur.execute(AGGREGATE, (WINDOW_SECONDS, ATTEMPTS))
                offenders = cur.fetchall()
            for ip, attempts, _last_ts in offenders:
                handle(conn, ip, int(attempts))
            sweep_expired(conn)
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
