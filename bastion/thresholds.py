"""Single source of truth for Bastion's brute-force thresholds.

Rule: more than ATTEMPTS SSH attempts from one source IP within WINDOW_SECONDS
=> block that IP from SSH for BLOCK_SECONDS. Enforced two ways: the target's
ipset (per-entry timeout) AND a VPC edge firewall DENY rule (which has no TTL, so
the cycle's sweeper deletes it on expiry).
"""

from __future__ import annotations

import os

# > ATTEMPTS within WINDOW_SECONDS trips a block. "More than 5 in a minute".
ATTEMPTS = int(os.environ.get("BASTION_ATTEMPTS", "5"))
WINDOW_SECONDS = int(os.environ.get("BASTION_WINDOW_SECONDS", "60"))
BLOCK_SECONDS = int(os.environ.get("BASTION_BLOCK_SECONDS", "300"))  # 5 minutes

# CRITICAL once an IP is at >= 2x the threshold in the window, else WARN.
CRITICAL_FACTOR = float(os.environ.get("BASTION_CRITICAL_FACTOR", "2.0"))


def severity_for(attempts: int) -> str:
    if attempts >= ATTEMPTS * CRITICAL_FACTOR:
        return "CRITICAL"
    return "WARN"
