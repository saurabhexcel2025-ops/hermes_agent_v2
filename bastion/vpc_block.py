"""VPC edge enforcement for Bastion — defense-in-depth alongside ipset.

On a block, Bastion creates an INGRESS DENY firewall rule (priority 100, tcp:22)
for the offending /32 in the target's GCP project, so the attacker is dropped at
the network edge before the packet ever reaches the VM. ipset stays the primary
control; this is additive and BEST-EFFORT — any failure here is logged and never
breaks the ipset block.

VPC firewall rules have no per-entry TTL (unlike ipset), so the cycle's sweeper
deletes the rule when the block expires (see bastion_cycle.sweep_expired).

Auth: a dedicated service account key (cloud-platform scope) mounted into the
container. A downloaded key authenticates with its IAM-granted scope regardless
of the host VM's instance scopes. Gated by BASTION_VPC_ENABLE so the daemon runs
cleanly until the key + project are configured.

Env:
  BASTION_VPC_ENABLE      "true" to turn on VPC enforcement (default off)
  BASTION_GCP_PROJECT     project that owns the firewall + target (required)
  BASTION_GCP_NETWORK     VPC network name (default "default")
  BASTION_GCP_SA_KEY      path to the SA JSON key (default /data/bastion/gcp-fw-sa.json)
  BASTION_VPC_PRIORITY    rule priority; must beat the allow-ssh rule (default 100)
  BASTION_VPC_RULE_PREFIX firewall rule name prefix (default "bastion-deny")
"""

from __future__ import annotations

import json
import logging
import os
import urllib.error
import urllib.request

log = logging.getLogger(__name__)

ENABLE = os.environ.get("BASTION_VPC_ENABLE", "false").lower() in ("1", "true", "yes")
PROJECT = os.environ.get("BASTION_GCP_PROJECT", "")
NETWORK = os.environ.get("BASTION_GCP_NETWORK", "default")
KEY_FILE = os.environ.get("BASTION_GCP_SA_KEY", "/data/bastion/gcp-fw-sa.json")
PRIORITY = int(os.environ.get("BASTION_VPC_PRIORITY", "100"))
PREFIX = os.environ.get("BASTION_VPC_RULE_PREFIX", "bastion-deny")

SCOPES = ["https://www.googleapis.com/auth/cloud-platform"]
API = "https://compute.googleapis.com/compute/v1"


def enabled() -> bool:
    return ENABLE and bool(PROJECT)


def rule_name(ip: str) -> str:
    """GCE resource names must match [a-z]([-a-z0-9]*[a-z0-9])? — dot/colon -> dash."""
    safe = ip.replace(".", "-").replace(":", "-")
    return f"{PREFIX}-{safe}"


def _token() -> str:
    # Imported lazily so the daemon starts even if google-auth isn't present yet
    # (e.g. VPC enforcement left disabled).
    from google.auth.transport.requests import Request
    from google.oauth2 import service_account

    creds = service_account.Credentials.from_service_account_file(KEY_FILE, scopes=SCOPES)
    creds.refresh(Request())
    return creds.token


def _api(method: str, path: str, body: dict | None = None) -> dict:
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        f"{API}{path}",
        data=data,
        method=method,
        headers={
            "Authorization": f"Bearer {_token()}",
            "Content-Type": "application/json",
        },
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read() or b"{}")


def vpc_block(ip: str) -> tuple[bool, str]:
    """Create a DENY firewall rule for <ip>/32 on tcp:22. Returns (ok, action)."""
    name = rule_name(ip)
    if not enabled():
        return False, f"vpc-skip:{name}"
    body = {
        "name": name,
        "network": f"projects/{PROJECT}/global/networks/{NETWORK}",
        "direction": "INGRESS",
        "priority": PRIORITY,
        "sourceRanges": [f"{ip}/32"],
        "denied": [{"IPProtocol": "tcp", "ports": ["22"]}],
        "description": "Bastion auto SSH brute-force block",
    }
    try:
        _api("POST", f"/projects/{PROJECT}/global/firewalls", body)
        return True, f"vpc DENY {name} (tcp:22 from {ip}/32, prio {PRIORITY})"
    except urllib.error.HTTPError as exc:
        if exc.code == 409:  # already exists -> idempotent success
            return True, f"vpc rule {name} already present"
        log.error("vpc_block %s failed: HTTP %s %s", ip, exc.code, exc.read()[:300])
        return False, f"vpc-FAILED:{name}"
    except Exception:
        log.exception("vpc_block %s raised", ip)
        return False, f"vpc-FAILED:{name}"


def vpc_unblock(ip: str) -> bool:
    """Delete the DENY firewall rule for <ip>. Returns True if gone/deleted."""
    name = rule_name(ip)
    if not enabled():
        return False
    try:
        _api("DELETE", f"/projects/{PROJECT}/global/firewalls/{name}")
        return True
    except urllib.error.HTTPError as exc:
        if exc.code == 404:  # already gone
            return True
        log.error("vpc_unblock %s failed: HTTP %s", ip, exc.code)
        return False
    except Exception:
        log.exception("vpc_unblock %s raised", ip)
        return False
