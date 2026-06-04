"""Telemetry probe — reads metrics from the target server.

Two modes, selected by env:
  - SENTINEL_TARGET_HOST set  -> SSH into the target and run a portable bash
    probe that reads /proc and `ps`. Works on any stock Linux target with no
    software installed on it beyond an SSH server.
  - not set                   -> read the LOCAL host via the same bash probe
    (handy for development/testing).

Returns a dict of satellite-named metrics plus the top CPU process.
"""

from __future__ import annotations

import os
import shlex
import subprocess


# Portable shell probe. Computes CPU% from a 1s /proc/stat delta, memory% from
# /proc/meminfo, disk write + net throughput from /proc deltas, process count,
# and the single highest-CPU process. Emits one space-separated line:
#   cpu mem disk_write_kbs downlink_kbs uplink_kbs nproc top_pid top_cpu top_comm
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
dwr=$(awk -v a=$dw1 -v b=$dw2 'BEGIN{printf "%.1f", (b-a)*512/1024}')   # sectors*512 -> KB over 1s
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


def _run_probe() -> str:
    host = os.environ.get("SENTINEL_TARGET_HOST")
    if host:
        user = os.environ.get("SENTINEL_TARGET_USER", "root")
        key = os.environ.get("SENTINEL_SSH_KEY")
        port = os.environ.get("SENTINEL_TARGET_PORT", "22")
        cmd = ["ssh", "-p", port,
               "-o", "StrictHostKeyChecking=accept-new",
               "-o", "ConnectTimeout=10",
               "-o", "BatchMode=yes"]
        if key:
            cmd += ["-i", key]
        cmd += [f"{user}@{host}", f"bash -c {shlex.quote(REMOTE_PROBE)}"]
    else:
        # Local fallback for development.
        cmd = ["bash", "-c", REMOTE_PROBE]

    out = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
    if out.returncode != 0:
        raise RuntimeError(f"probe failed: {out.stderr.strip() or out.stdout.strip()}")
    return out.stdout.strip().splitlines()[-1]


def read_telemetry() -> dict:
    """Return one telemetry sample as a dict of satellite-named metrics."""
    parts = _run_probe().split()
    if len(parts) < 9:
        raise RuntimeError(f"probe returned {len(parts)} fields, expected 9: {parts!r}")
    cpu, mem, dwr, dl, ul, nproc, tpid, tcpu, *comm = parts
    return {
        "target": os.environ.get("SENTINEL_TARGET_HOST") or "localhost",
        "processor_load": float(cpu),
        "ram_saturation": float(mem),
        "storage_write": float(dwr),
        "downlink": float(dl),
        "uplink": float(ul),
        "active_subsys": int(nproc),
        "top_pid": int(tpid) if tpid.isdigit() else None,
        "top_cpu": float(tcpu) if tcpu.replace(".", "", 1).isdigit() else None,
        "top_proc": " ".join(comm) if comm else None,
    }
