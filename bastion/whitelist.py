"""IP whitelist — IPs/CIDRs that are NEVER blocked, no matter how many attempts.

CRITICAL safety net. Bastion's own collector SSHes into the target on every
poll from mission-control-one, which alone exceeds the >5/min rule. Without a
whitelist Bastion would firewall out its own monitoring (and your admin SSH).

Default covers all private ranges + loopback, so any in-VPC / internal traffic
(the monitoring path uses the internal 10.x address) is safe out of the box.
Add your public admin IP via BASTION_WHITELIST (comma-separated CIDRs/IPs).
"""

from __future__ import annotations

import ipaddress
import logging
import os

log = logging.getLogger(__name__)

_DEFAULTS = "127.0.0.0/8,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,::1/128,fc00::/7"


def _load_networks() -> list:
    raw = os.environ.get("BASTION_WHITELIST", "")
    entries = [e.strip() for e in (_DEFAULTS + "," + raw).split(",") if e.strip()]
    nets = []
    for e in entries:
        try:
            nets.append(ipaddress.ip_network(e, strict=False))
        except ValueError:
            log.warning("bastion whitelist: ignoring invalid entry %r", e)
    return nets


_NETWORKS = _load_networks()


def is_whitelisted(ip: str) -> bool:
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return False
    return any(addr in net for net in _NETWORKS)
