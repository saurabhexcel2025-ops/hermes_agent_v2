"""Single source of truth for anomaly thresholds.

Severity classification for each telemetry metric. CPU is the primary signal
for the demo; the rest are included so the dashboard panels light up coherently.
"""

from __future__ import annotations


# (warn_at, critical_at) per metric, in the metric's own units.
THRESHOLDS = {
    "processor_load": (70.0, 90.0),   # CPU %
    "ram_saturation": (75.0, 90.0),   # Memory %
    "storage_write":  (50_000.0, 100_000.0),  # KB/s
    "downlink":       (80_000.0, 120_000.0),  # KB/s
    "uplink":         (80_000.0, 120_000.0),  # KB/s
}

_RANK = {"NORMAL": 0, "WARN": 1, "CRITICAL": 2}


def classify_metric(name: str, value: float | None) -> str:
    """Return NORMAL | WARN | CRITICAL for a single metric value."""
    if value is None or name not in THRESHOLDS:
        return "NORMAL"
    warn_at, crit_at = THRESHOLDS[name]
    if value >= crit_at:
        return "CRITICAL"
    if value >= warn_at:
        return "WARN"
    return "NORMAL"


def overall_severity(metrics: dict[str, float | None]) -> str:
    """Worst severity across all classified metrics."""
    worst = "NORMAL"
    for name, value in metrics.items():
        sev = classify_metric(name, value)
        if _RANK[sev] > _RANK[worst]:
            worst = sev
    return worst


def describe_anomaly(metrics: dict[str, float | None]) -> str:
    """Human-readable description of which metrics breached, for the audit log."""
    breaches = []
    for name, value in metrics.items():
        sev = classify_metric(name, value)
        if sev != "NORMAL":
            breaches.append(f"{name}={value:.1f} ({sev})")
    return "; ".join(breaches) if breaches else "nominal"
