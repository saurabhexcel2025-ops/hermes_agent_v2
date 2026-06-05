"""Bastion collector (Gatekeeper's job).

Every BASTION_POLL_SECONDS, read recent sshd attempts from the target and write
them to the ssh_events table. Idempotent: raw_hash has a UNIQUE index so
overlapping poll windows never double-count. The Bastion cycle and the Mission
Control dashboard both read this table.
"""

from __future__ import annotations

import logging
import os
import time

from db import connect
from probe import read_events

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s bastion.collector %(levelname)s %(message)s",
)
log = logging.getLogger(__name__)

POLL = int(os.environ.get("BASTION_POLL_SECONDS", "5"))

# event_ts: use the parsed log time when we have one (event_unix > 0), else the
# DB clock (now()). ON CONFLICT keeps ingestion idempotent.
INSERT = """
INSERT INTO ssh_events
  (event_ts, target, src_ip, username, result, raw, raw_hash)
VALUES
  (CASE WHEN %(event_unix)s > 0 THEN to_timestamp(%(event_unix)s) ELSE now() END,
   %(target)s, %(src_ip)s, %(username)s, %(result)s, %(raw)s, %(raw_hash)s)
ON CONFLICT (raw_hash) DO NOTHING
"""


def main() -> None:
    conn = connect()
    log.info("collector started — polling every %ss", POLL)
    while True:
        start = time.monotonic()
        try:
            events = read_events()
            new = 0
            with conn.cursor() as cur:
                for ev in events:
                    cur.execute(INSERT, ev)
                    new += cur.rowcount
            if new:
                log.info("ingested %d new SSH attempt(s)", new)
        except Exception:
            log.exception("poll failed")
            try:
                conn.close()
            except Exception:
                pass
            conn = connect()
        elapsed = time.monotonic() - start
        time.sleep(max(0.0, POLL - elapsed))


if __name__ == "__main__":
    main()
