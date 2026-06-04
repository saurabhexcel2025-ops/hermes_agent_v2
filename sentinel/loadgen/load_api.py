#!/usr/bin/env python3
"""CPU load API — runs ON the target server (space-armour-server).

Hit an HTTP endpoint to spike the target's CPU so Sentinel detects/logs it and
the Sentinel Ops page lights up. Demo helper only.

Endpoints (all GET):
  /                 usage
  /spike            start a CPU burn. query: seconds (1..300, def 30),
                    workers (1..2*ncpu, def ncpu), token (if SPIKE_TOKEN set)
  /status           how many burn workers are currently running
  /stop             stop all burn workers

Env: SPIKE_PORT (default 8099), SPIKE_TOKEN (optional shared secret).
"""

from __future__ import annotations

import json
import os
import subprocess
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

PORT = int(os.environ.get("SPIKE_PORT", "8099"))
TOKEN = os.environ.get("SPIKE_TOKEN", "")
NPROC = os.cpu_count() or 1

_active: list[subprocess.Popen] = []


def _cleanup() -> None:
    global _active
    _active = [p for p in _active if p.poll() is None]


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args) -> None:  # silence default logging
        pass

    def _json(self, code: int, obj: dict) -> None:
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        u = urlparse(self.path)
        q = parse_qs(u.query)

        if u.path == "/":
            return self._json(200, {
                "service": "cpu-load-api",
                "cpu_count": NPROC,
                "endpoints": {
                    "/spike": "?seconds=30&workers=N&token=...",
                    "/status": "running workers",
                    "/stop": "stop all",
                },
            })

        if TOKEN and q.get("token", [""])[0] != TOKEN:
            return self._json(401, {"error": "invalid or missing token"})

        if u.path == "/status":
            _cleanup()
            return self._json(200, {"active_workers": len(_active), "cpu_count": NPROC})

        if u.path == "/stop":
            for p in _active:
                try:
                    p.terminate()
                except Exception:
                    pass
            _cleanup()
            return self._json(200, {"stopped": True})

        if u.path == "/spike":
            try:
                seconds = max(1, min(300, int(q.get("seconds", ["30"])[0])))
            except ValueError:
                seconds = 30
            try:
                workers = int(q.get("workers", [str(NPROC)])[0])
            except ValueError:
                workers = NPROC
            workers = max(1, min(workers, NPROC * 2))
            _cleanup()
            for _ in range(workers):
                # `timeout` bounds the burn so it always self-terminates.
                p = subprocess.Popen(
                    ["timeout", str(seconds), "sha1sum", "/dev/zero"],
                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                )
                _active.append(p)
            return self._json(200, {
                "status": "spiking", "seconds": seconds,
                "workers": workers, "cpu_count": NPROC,
            })

        return self._json(404, {"error": "not found"})


if __name__ == "__main__":
    print(f"cpu-load-api listening on 0.0.0.0:{PORT} (cpus={NPROC}, token={'set' if TOKEN else 'none'})")
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
