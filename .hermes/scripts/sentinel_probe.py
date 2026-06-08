#!/usr/bin/env python3
"""Sentinel pre-processing script (Hermes-native).

Runs as the `--script` of the Sentinel cron routine. Each tick it:
  1. SSHes the target and reads a telemetry sample (CPU/RAM/disk/net/procs).
  2. Classifies severity and writes one row to the `telemetry` table (so the
     Mission Control dashboard keeps updating exactly as before).
  3. Detects the rising edge into an anomaly (prev sample NORMAL -> WARN/CRIT).
  4. On an incident, prints an INCIDENT packet to stdout — the telemetry
     snapshot + the matching SOP text + the telemetry_id — which Hermes injects
     into the Sentinel agent's prompt. The agent reasons over it and seals the
     audit row via the sentinel-ops skill.
  5. Otherwise prints `[SILENT]` so the routine produces no notification.

Self-contained: stdlib + psycopg2 only (no embeddings). The SOP is selected by
which metric breached, read straight from the sentinel/sop/*.md files.

Env (same vars the daemon used; provided via .hermes/.env or the profile):
  SENTINEL_TARGET_HOST/USER/PORT, SENTINEL_SSH_KEY, POSTGRES_* (or DATABASE_URL),
  SENTINEL_SOP_DIR (defaults to the repo's sentinel/sop).
"""

from __future__ import annotations

import json
import os
import shlex
import subprocess
import sys

import psycopg2

# ── Portable telemetry probe (identical to the daemon's probe.py) ───────────
REMOTE_PROBE = r"""
read _ a b c d e f g h _ < <(grep '^cpu ' /proc/stat); t1=$((a+b+c+d+e+f+g+h)); i1=$d
dw1=$(awk '{w+=$10} END{print w}' /proc/diskstats)
read _ rb1 _ _ _ _ _ _ _ tb1 _ < <(awk -F'[: ]+' 'NR>2{rb+=$3; tb+=$11} END{print "x", rb, 0,0,0,0,0,0,0, tb}' /proc/net/dev)
sleep 1
read _ a b c d e f g h _ < <(grep '^cpu ' /proc/stat); t2=$((a+b+c+d+e+f+g+h)); i2=$d
dw2=$(awk '{w+=$10} END{print w}' /proc/diskstats)
read _ rb2 _ _ _ _ _ _ _ tb2 _ < <(awk -F'[: ]+' 'NR>2{rb+=$3; tb+=$11} END{print "x", rb, 0,0,0,0,0,0,0, tb}' /proc/net/dev)
cpu=$(awk -v t1=$t1 -v t2=$t2 -v i1=$i1 -v i2=$i2 'BEGIN{dt=t2-t1; if(dt<=0){print 0}else{printf "%.1f", (1-(i2-i1)/dt)*100}}')
mem=$(awk '/MemTotal/{t=$2} /MemAvailable/{a=$2} END{printf "%.1f", (1-a/t)*100}' /proc/meminfo)
dwr=$(awk -v a=$dw1 -v b=$dw2 'BEGIN{printf "%.1f", (b-a)*512/1024}')
dl=$(awk -v a=$rb1 -v b=$rb2 'BEGIN{printf "%.1f", (b-a)/1024}')
ul=$(awk -v a=$tb1 -v b=$tb2 'BEGIN{printf "%.1f", (b-a)/1024}')
nproc=$(ls -d /proc/[0-9]* 2>/dev/null | wc -l)
tpid=0; tcpu=0; tcomm=none
if command -v ps >/dev/null 2>&1; then
  top=$(ps -eo pid,%cpu,comm --sort=-%cpu --no-headers 2>/dev/null | head -1)
  if [ -n "$top" ]; then
    tpid=$(echo "$top" | awk '{print $1+0}')
    tcpu=$(echo "$top" | awk '{print $2+0}')
    tcomm=$(echo "$top" | awk '{print $3}')
  fi
fi
echo "$cpu $mem $dwr $dl $ul $nproc $tpid $tcpu $tcomm"
"""

# (warn_at, critical_at) per metric + the SOP file that covers it.
THRESHOLDS = {
    "processor_load": (70.0, 90.0, "cpu-overload.md"),
    "ram_saturation": (75.0, 90.0, "memory-pressure.md"),
    "storage_write":  (50_000.0, 100_000.0, "storage-saturation.md"),
    "downlink":       (80_000.0, 120_000.0, "comms-degradation.md"),
    "uplink":         (80_000.0, 120_000.0, "comms-degradation.md"),
}
_RANK = {"NORMAL": 0, "WARN": 1, "CRITICAL": 2}

INSERT = """
INSERT INTO telemetry
  (target, processor_load, ram_saturation, storage_write, downlink, uplink,
   active_subsys, top_proc, top_pid, top_cpu, severity)
VALUES
  (%(target)s, %(processor_load)s, %(ram_saturation)s, %(storage_write)s,
   %(downlink)s, %(uplink)s, %(active_subsys)s, %(top_proc)s, %(top_pid)s,
   %(top_cpu)s, %(severity)s)
RETURNING id
"""
PREV_SEVERITY = "SELECT severity FROM telemetry ORDER BY id DESC LIMIT 1"


def dsn() -> str:
    url = os.environ.get("DATABASE_URL")
    if url:
        return url
    return (f"host={os.environ.get('POSTGRES_HOST', 'postgres')} "
            f"port={os.environ.get('POSTGRES_PORT', '5432')} "
            f"dbname={os.environ.get('POSTGRES_DB', 'hermes_auth')} "
            f"user={os.environ.get('POSTGRES_USER', 'hermes')} "
            f"password={os.environ.get('POSTGRES_PASSWORD', '')}")


def read_telemetry() -> dict:
    host = os.environ.get("SENTINEL_TARGET_HOST")
    if host:
        cmd = ["ssh", "-p", os.environ.get("SENTINEL_TARGET_PORT", "22"),
               "-o", "StrictHostKeyChecking=accept-new",
               "-o", "ConnectTimeout=10", "-o", "BatchMode=yes"]
        key = os.environ.get("SENTINEL_SSH_KEY")
        if key:
            cmd += ["-i", key]
        cmd += [f"{os.environ.get('SENTINEL_TARGET_USER', 'root')}@{host}",
                f"bash -c {shlex.quote(REMOTE_PROBE)}"]
    else:
        cmd = ["bash", "-c", REMOTE_PROBE]
    out = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
    if out.returncode != 0:
        raise RuntimeError(f"probe failed: {out.stderr.strip() or out.stdout.strip()}")
    parts = out.stdout.strip().splitlines()[-1].split()
    cpu, mem, dwr, dl, ul, nproc, tpid, tcpu, *comm = parts
    return {
        "target": host or "localhost",
        "processor_load": float(cpu), "ram_saturation": float(mem),
        "storage_write": float(dwr), "downlink": float(dl), "uplink": float(ul),
        "active_subsys": int(nproc),
        "top_pid": int(tpid) if tpid.isdigit() else None,
        "top_cpu": float(tcpu) if tcpu.replace(".", "", 1).isdigit() else None,
        "top_proc": " ".join(comm) if comm else None,
    }


def classify(sample: dict) -> tuple[str, list[str], str | None]:
    """Return (overall_severity, breached descriptions, sop_filename)."""
    worst, breaches, sop = "NORMAL", [], None
    for name, (warn, crit, sop_file) in THRESHOLDS.items():
        v = sample.get(name)
        if v is None:
            continue
        sev = "CRITICAL" if v >= crit else "WARN" if v >= warn else "NORMAL"
        if sev != "NORMAL":
            breaches.append(f"{name}={v:.1f} ({sev})")
            if _RANK[sev] >= _RANK[worst]:
                worst, sop = sev, sop_file
    return worst, breaches, sop


def load_sop(sop_file: str) -> tuple[str, str]:
    sop_dir = os.environ.get(
        "SENTINEL_SOP_DIR",
        os.path.join(os.path.dirname(__file__), "..", "..", "sentinel", "sop"),
    )
    path = os.path.join(sop_dir, sop_file)
    try:
        with open(path, encoding="utf-8") as fh:
            return sop_file.removesuffix(".md"), fh.read()
    except OSError:
        return sop_file.removesuffix(".md"), ""


def main() -> int:
    conn = psycopg2.connect(dsn())
    conn.autocommit = True
    with conn.cursor() as cur:
        cur.execute(PREV_SEVERITY)
        prev = cur.fetchone()
    prev_sev = prev[0] if prev else "NORMAL"

    sample = read_telemetry()
    severity, breaches, sop_file = classify(sample)
    sample["severity"] = severity
    with conn.cursor() as cur:
        cur.execute(INSERT, sample)
        telemetry_id = cur.fetchone()[0]

    # Only surface the rising edge into an anomaly — otherwise stay silent.
    if severity == "NORMAL" or prev_sev != "NORMAL":
        print("[SILENT]")
        return 0

    sop_ref, sop_body = load_sop(sop_file) if sop_file else (None, "")
    packet = {
        "telemetry_id": telemetry_id,
        "target": sample["target"],
        "severity": severity,
        "anomaly": "; ".join(breaches),
        "culprit_proc": sample.get("top_proc"),
        "culprit_pid": sample.get("top_pid"),
        "culprit_cpu": sample.get("top_cpu"),
        "sop_ref": sop_ref,
    }
    print("=== SENTINEL INCIDENT ===")
    print(json.dumps(packet, default=str, indent=2))
    print("\n--- Relevant SOP ---\n" + sop_body)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:  # never crash the routine; report and stay silent
        print(f"[SILENT] (sentinel_probe error: {exc})")
        sys.exit(0)
