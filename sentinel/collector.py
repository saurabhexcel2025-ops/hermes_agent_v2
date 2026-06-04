"""Sentinel collector (Watchtower's job).

Every SENTINEL_POLL_SECONDS (default 10), probe the target server, classify
severity, and write one row to the telemetry table. The Sentinel cycle and the
Mission Control dashboard both read this table.
"""

from __future__ import annotations

import logging
import os
import time

from db import connect
from probe import read_telemetry
from thresholds import overall_severity

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s sentinel.collector %(levelname)s %(message)s",
)
log = logging.getLogger(__name__)

POLL = int(os.environ.get("SENTINEL_POLL_SECONDS", "10"))

INSERT = """
INSERT INTO telemetry
  (target, processor_load, ram_saturation, storage_write, downlink, uplink,
   active_subsys, top_proc, top_pid, top_cpu, severity)
VALUES
  (%(target)s, %(processor_load)s, %(ram_saturation)s, %(storage_write)s,
   %(downlink)s, %(uplink)s, %(active_subsys)s, %(top_proc)s, %(top_pid)s,
   %(top_cpu)s, %(severity)s)
"""

# Which metrics feed the severity decision.
SEVERITY_KEYS = ("processor_load", "ram_saturation", "storage_write",
                 "downlink", "uplink")


def main() -> None:
    conn = connect()
    log.info("collector started — polling every %ss", POLL)
    while True:
        start = time.monotonic()
        try:
            sample = read_telemetry()
            sample["severity"] = overall_severity(
                {k: sample.get(k) for k in SEVERITY_KEYS}
            )
            with conn.cursor() as cur:
                cur.execute(INSERT, sample)
            log.info("CPU=%.1f%% sev=%s top=%s",
                     sample["processor_load"], sample["severity"],
                     sample.get("top_proc"))
        except Exception:
            log.exception("poll failed")
            # Reconnect on the next loop if the connection went bad.
            try:
                conn.close()
            except Exception:
                pass
            conn = connect()
        # Keep a steady cadence regardless of probe duration.
        elapsed = time.monotonic() - start
        time.sleep(max(0.0, POLL - elapsed))


if __name__ == "__main__":
    main()
