#!/usr/bin/env python3
"""
Hindsight Server — persistent HTTP server for memory operations.
Starts once, stays resident, handles all retain/recall calls via HTTP.
No per-call Python spawning = no lag.
"""
import os
import sys
import signal
import time
from pathlib import Path

HERMES_HOME = Path(os.environ.get("HERMES_HOME", os.path.expanduser("~/.hermes"))).expanduser()
AGENT_PKG = HERMES_HOME / "hermes-agent"
if AGENT_PKG.is_dir():
    sys.path.insert(0, str(AGENT_PKG))
else:
    raise RuntimeError(f"Hermes agent not found at {AGENT_PKG} — run: hermes update")

def main():
    from hindsight import start_server

    # Read API key from .env
    api_key = ""
    env_path = HERMES_HOME / ".env"
    if env_path.is_file():
        with open(env_path, encoding="utf-8") as f:
            for line in f:
                if line.strip().startswith("HINDSIGHT_LLM_API_KEY="):
                    api_key = line.split("=", 1)[1].strip().strip('"').strip("'")
                    break

    print("Starting Hindsight server...")
    print(f"  DB: PostgreSQL @ localhost:5432/hindsight_db")
    print(f"  LLM: Nous (xiaomi/mimo-v2-pro) via gateway API")

    server = start_server(
        db_url="postgresql://hindsight_user:hindsight_local@localhost:5432/hindsight_db",
        llm_provider="openai",
        llm_api_key=api_key,
        llm_model="xiaomi/mimo-v2-pro",
        llm_base_url="http://localhost:8642/v1",
        host="127.0.0.1",
        port=9177,
        log_level="info",
        timeout=120,
    )

    print(f"Hindsight server running at {server.url}")
    print("Press Ctrl+C to stop")

    # Handle shutdown
    def shutdown(sig, frame):
        print("\nShutting down Hindsight server...")
        server.stop()
        sys.exit(0)

    signal.signal(signal.SIGINT, shutdown)
    signal.signal(signal.SIGTERM, shutdown)

    # Keep alive
    signal.pause()


if __name__ == "__main__":
    main()
