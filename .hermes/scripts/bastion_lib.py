#!/usr/bin/env python3
"""Shared helpers for the Bastion Hermes-native routine.

Imported by both `bastion_probe.py` (the cron --script) and the bastion-guard
skill's `enforce_block.py`. Keeps DB access, SSH exec, the whitelist, ipset
enforcement, and VPC firewall enforcement in one place so detection and
enforcement agree on the exact same rules.
"""

from __future__ import annotations

import ipaddress
import json
import os
import shlex
import subprocess
import urllib.error
import urllib.request

import psycopg2

# ── Thresholds (same knobs as the daemon; env-overridable) ──────────────────
ATTEMPTS = int(os.environ.get("BASTION_ATTEMPTS", "5"))
WINDOW_SECONDS = int(os.environ.get("BASTION_WINDOW_SECONDS", "60"))
BLOCK_SECONDS = int(os.environ.get("BASTION_BLOCK_SECONDS", "300"))  # 5 minutes
CRITICAL_FACTOR = float(os.environ.get("BASTION_CRITICAL_FACTOR", "2.0"))
IPSET_NAME = os.environ.get("BASTION_IPSET_NAME", "bastion_block")
SUDO = os.environ.get("BASTION_SUDO", "sudo")


def severity_for(attempts: int) -> str:
    return "CRITICAL" if attempts >= ATTEMPTS * CRITICAL_FACTOR else "WARN"


# ── Postgres ────────────────────────────────────────────────────────────────
def dsn() -> str:
    url = os.environ.get("DATABASE_URL")
    if url:
        return url
    return (f"host={os.environ.get('POSTGRES_HOST', 'postgres')} "
            f"port={os.environ.get('POSTGRES_PORT', '5432')} "
            f"dbname={os.environ.get('POSTGRES_DB', 'hermes_auth')} "
            f"user={os.environ.get('POSTGRES_USER', 'hermes')} "
            f"password={os.environ.get('POSTGRES_PASSWORD', '')}")


def connect():
    conn = psycopg2.connect(dsn())
    conn.autocommit = True
    return conn


# ── SSH to the target ────────────────────────────────────────────────────────
def _ssh_base() -> list[str] | None:
    host = os.environ.get("BASTION_TARGET_HOST")
    if not host:
        return None
    cmd = ["ssh", "-p", os.environ.get("BASTION_TARGET_PORT", "22"),
           "-o", "StrictHostKeyChecking=accept-new",
           "-o", "ConnectTimeout=10", "-o", "BatchMode=yes"]
    key = os.environ.get("BASTION_SSH_KEY")
    if key:
        cmd += ["-i", key]
    return cmd + [f"{os.environ.get('BASTION_TARGET_USER', 'root')}@{host}"]


def ssh_exec(remote_cmd: str, timeout: int = 30) -> tuple[int, str, str]:
    base = _ssh_base()
    cmd = ["bash", "-c", remote_cmd] if base is None else base + [f"bash -c {shlex.quote(remote_cmd)}"]
    out = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    return out.returncode, out.stdout, out.stderr


# ── Whitelist (NEVER block these) ────────────────────────────────────────────
_DEFAULTS = "127.0.0.0/8,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,::1/128,fc00::/7"
_NETWORKS = []
for _e in [e.strip() for e in (_DEFAULTS + "," + os.environ.get("BASTION_WHITELIST", "")).split(",") if e.strip()]:
    try:
        _NETWORKS.append(ipaddress.ip_network(_e, strict=False))
    except ValueError:
        pass


def is_whitelisted(ip: str) -> bool:
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return False
    return any(addr in net for net in _NETWORKS)


# ── Host enforcement (ipset over SSH) ────────────────────────────────────────
def ipset_block(ip: str) -> tuple[bool, str]:
    action = f"{SUDO} ipset add {IPSET_NAME} {ip} timeout {BLOCK_SECONDS} -exist"
    try:
        rc, out, err = ssh_exec(action, timeout=20)
        return (rc == 0), action
    except Exception:
        return False, action


def ipset_unblock(ip: str) -> None:
    try:
        ssh_exec(f"{SUDO} ipset del {IPSET_NAME} {ip} -exist", timeout=15)
    except Exception:
        pass


# ── VPC edge enforcement (firewall create/delete via Compute API) ────────────
_VPC_ENABLE = os.environ.get("BASTION_VPC_ENABLE", "false").lower() in ("1", "true", "yes")
_VPC_PROJECT = os.environ.get("BASTION_GCP_PROJECT", "")
_VPC_NETWORK = os.environ.get("BASTION_GCP_NETWORK", "default")
_VPC_KEY = os.environ.get("BASTION_GCP_SA_KEY", os.path.expanduser("~/.hermes/scripts/gcp-fw-sa.json"))
_VPC_PRIORITY = int(os.environ.get("BASTION_VPC_PRIORITY", "100"))
_VPC_PREFIX = os.environ.get("BASTION_VPC_RULE_PREFIX", "bastion-deny")
_COMPUTE = "https://compute.googleapis.com/compute/v1"


def vpc_enabled() -> bool:
    return _VPC_ENABLE and bool(_VPC_PROJECT)


def vpc_rule_name(ip: str) -> str:
    return f"{_VPC_PREFIX}-{ip.replace('.', '-').replace(':', '-')}"


def _vpc_token() -> str:
    from google.auth.transport.requests import Request
    from google.oauth2 import service_account
    creds = service_account.Credentials.from_service_account_file(
        _VPC_KEY, scopes=["https://www.googleapis.com/auth/cloud-platform"])
    creds.refresh(Request())
    return creds.token


def _vpc_api(method: str, path: str, body: dict | None = None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        f"{_COMPUTE}{path}", data=data, method=method,
        headers={"Authorization": f"Bearer {_vpc_token()}",
                 "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read() or b"{}")


def vpc_block(ip: str) -> tuple[bool, str]:
    name = vpc_rule_name(ip)
    if not vpc_enabled():
        return False, f"vpc-skip:{name}"
    body = {
        "name": name,
        "network": f"projects/{_VPC_PROJECT}/global/networks/{_VPC_NETWORK}",
        "direction": "INGRESS", "priority": _VPC_PRIORITY,
        "sourceRanges": [f"{ip}/32"],
        "denied": [{"IPProtocol": "tcp", "ports": ["22"]}],
        "description": "Bastion auto SSH brute-force block",
    }
    try:
        _vpc_api("POST", f"/projects/{_VPC_PROJECT}/global/firewalls", body)
        return True, f"vpc DENY {name} (tcp:22 from {ip}/32, prio {_VPC_PRIORITY})"
    except urllib.error.HTTPError as exc:
        if exc.code == 409:
            return True, f"vpc rule {name} already present"
        return False, f"vpc-FAILED:{name}:{exc.code}"
    except Exception as exc:
        return False, f"vpc-FAILED:{name}:{exc}"


def vpc_unblock(ip: str) -> bool:
    name = vpc_rule_name(ip)
    if not vpc_enabled():
        return False
    try:
        _vpc_api("DELETE", f"/projects/{_VPC_PROJECT}/global/firewalls/{name}")
        return True
    except urllib.error.HTTPError as exc:
        return exc.code == 404
    except Exception:
        return False


# ── Shared queries ───────────────────────────────────────────────────────────
COUNT_IN_WINDOW = """
SELECT COUNT(*) FROM ssh_events
WHERE src_ip = %s AND event_ts > now() - (%s || ' seconds')::interval
"""
ALREADY_BLOCKED = """
SELECT 1 FROM ssh_blocks
WHERE src_ip = %s AND released_at IS NULL AND expires_at > now() LIMIT 1
"""


def count_attempts(conn, ip: str) -> int:
    with conn.cursor() as cur:
        cur.execute(COUNT_IN_WINDOW, (ip, WINDOW_SECONDS))
        return int(cur.fetchone()[0])


def already_blocked(conn, ip: str) -> bool:
    with conn.cursor() as cur:
        cur.execute(ALREADY_BLOCKED, (ip,))
        return cur.fetchone() is not None
