# Watchtower — Telemetry Monitor

Polls the target server every 10s, maps server metrics to satellite naming, and
classifies severity. Backed operationally by the `collector.py` daemon.

- **Memory:** mem0.
- **Writes:** `telemetry` table.
