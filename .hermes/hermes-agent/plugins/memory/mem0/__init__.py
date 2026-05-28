"""Mem0 memory plugin — MemoryProvider interface.

Supports two modes:
  Self-hosted (default): MEM0_BASE_URL points to a local mem0 server.
  Cloud: MEM0_API_KEY uses the Mem0 Platform API.

Self-hosted config (recommended):
  MEM0_BASE_URL  — URL of the self-hosted mem0 server (e.g. http://localhost:8888)
  MEM0_USER_ID   — User identifier (default: hermes-user)
  MEM0_AGENT_ID  — Agent identifier (default: hermes)

Cloud config (fallback):
  MEM0_API_KEY   — Mem0 Platform API key
  MEM0_USER_ID   — User identifier (default: hermes-user)
  MEM0_AGENT_ID  — Agent identifier (default: hermes)

Or via $HERMES_HOME/mem0.json for any of the above.
"""

from __future__ import annotations

import json
import logging
import os
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Dict, List, Optional

from agent.memory_provider import MemoryProvider
from tools.registry import tool_error

logger = logging.getLogger(__name__)

_BREAKER_THRESHOLD = 5
_BREAKER_COOLDOWN_SECS = 120


# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

def _load_config() -> dict:
    from hermes_constants import get_hermes_home

    config = {
        "base_url": os.environ.get("MEM0_BASE_URL", ""),
        "api_key": os.environ.get("MEM0_API_KEY", ""),
        "user_id": os.environ.get("MEM0_USER_ID", "hermes-user"),
        "agent_id": os.environ.get("MEM0_AGENT_ID", "hermes"),
        "rerank": True,
    }

    config_path = get_hermes_home() / "mem0.json"
    if config_path.exists():
        try:
            file_cfg = json.loads(config_path.read_text(encoding="utf-8"))
            config.update({k: v for k, v in file_cfg.items() if v is not None and v != ""})
        except Exception:
            pass

    return config


# ---------------------------------------------------------------------------
# Self-hosted HTTP client
# ---------------------------------------------------------------------------

class _SelfHostedClient:
    """Minimal HTTP client for the self-hosted mem0 server."""

    def __init__(self, base_url: str):
        self._base = base_url.rstrip("/")

    def _post(self, path: str, body: dict, timeout: int = 30) -> dict:
        data = json.dumps(body).encode()
        req = urllib.request.Request(
            f"{self._base}{path}",
            data=data,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read())

    def _get(self, path: str, params: Optional[dict] = None, timeout: int = 15) -> dict:
        url = f"{self._base}{path}"
        if params:
            url += "?" + urllib.parse.urlencode(params)
        req = urllib.request.Request(url, method="GET")
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read())

    def _delete(self, path: str, timeout: int = 15) -> dict:
        req = urllib.request.Request(f"{self._base}{path}", method="DELETE")
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read())

    def add(self, messages: list, user_id: str = "hermes-user",
            agent_id: str = "hermes", infer: bool = True, **kwargs) -> dict:
        return self._post("/v1/memories", {
            "messages": messages,
            "user_id": user_id,
            "agent_id": agent_id,
            "infer": infer,
        }, timeout=60)

    def search(self, query: str, user_id: str = "hermes-user",
               rerank: bool = False, top_k: int = 10, **kwargs) -> dict:
        return self._get("/v1/memories/search", {
            "query": query,
            "user_id": user_id,
            "top_k": top_k,
        })

    def get_all(self, user_id: str = "hermes-user", **kwargs) -> dict:
        return self._get("/v1/memories", {"user_id": user_id})

    def delete(self, memory_id: str) -> dict:
        return self._delete(f"/v1/memories/{memory_id}")

    def health(self) -> dict:
        return self._get("/health", timeout=5)


# ---------------------------------------------------------------------------
# Tool schemas
# ---------------------------------------------------------------------------

PROFILE_SCHEMA = {
    "name": "mem0_profile",
    "description": (
        "Retrieve all stored memories about the user — preferences, facts, "
        "project context. Fast lookup. Use at conversation start."
    ),
    "parameters": {"type": "object", "properties": {}, "required": []},
}

SEARCH_SCHEMA = {
    "name": "mem0_search",
    "description": (
        "Search memories by meaning. Returns relevant facts ranked by similarity. "
        "Use when you need specific context about the user or past work."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "query": {"type": "string", "description": "What to search for."},
            "top_k": {"type": "integer", "description": "Max results (default: 10, max: 50)."},
        },
        "required": ["query"],
    },
}

CONCLUDE_SCHEMA = {
    "name": "mem0_conclude",
    "description": (
        "Store a durable fact about the user directly (no LLM extraction). "
        "Use for explicit preferences, corrections, or decisions the user states."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "conclusion": {"type": "string", "description": "The fact to store."},
        },
        "required": ["conclusion"],
    },
}


# ---------------------------------------------------------------------------
# Provider
# ---------------------------------------------------------------------------

class Mem0MemoryProvider(MemoryProvider):
    """Mem0 memory provider — self-hosted or cloud."""

    def __init__(self):
        self._config: dict = {}
        self._client = None
        self._client_lock = threading.Lock()
        self._mode = "none"  # "self-hosted" | "cloud"
        self._user_id = "hermes-user"
        self._agent_id = "hermes"
        self._rerank = True
        self._prefetch_result = ""
        self._prefetch_lock = threading.Lock()
        self._prefetch_thread: Optional[threading.Thread] = None
        self._sync_thread: Optional[threading.Thread] = None
        self._consecutive_failures = 0
        self._breaker_open_until = 0.0

    @property
    def name(self) -> str:
        return "mem0"

    def is_available(self) -> bool:
        cfg = _load_config()
        return bool(cfg.get("base_url") or cfg.get("api_key"))

    def save_config(self, values: dict, hermes_home: str) -> None:
        from pathlib import Path
        config_path = Path(hermes_home) / "mem0.json"
        existing: dict = {}
        if config_path.exists():
            try:
                existing = json.loads(config_path.read_text())
            except Exception:
                pass
        existing.update(values)
        config_path.write_text(json.dumps(existing, indent=2))

    def get_config_schema(self) -> list:
        return [
            {"key": "base_url", "description": "Self-hosted mem0 server URL (e.g. http://localhost:8888)", "default": "http://localhost:8888"},
            {"key": "api_key", "description": "Mem0 Platform API key (leave empty for self-hosted)", "secret": True, "env_var": "MEM0_API_KEY", "url": "https://app.mem0.ai"},
            {"key": "user_id", "description": "User identifier", "default": "hermes-user"},
            {"key": "agent_id", "description": "Agent identifier", "default": "hermes"},
        ]

    def _get_client(self):
        with self._client_lock:
            if self._client is not None:
                return self._client
            if self._mode == "self-hosted":
                self._client = _SelfHostedClient(self._config["base_url"])
            else:
                try:
                    from mem0 import MemoryClient
                    self._client = MemoryClient(api_key=self._config["api_key"])
                except ImportError:
                    raise RuntimeError("mem0ai package not installed. Run: pip install mem0ai")
            return self._client

    def _is_breaker_open(self) -> bool:
        if self._consecutive_failures < _BREAKER_THRESHOLD:
            return False
        if time.monotonic() >= self._breaker_open_until:
            self._consecutive_failures = 0
            return False
        return True

    def _record_success(self):
        self._consecutive_failures = 0

    def _record_failure(self):
        self._consecutive_failures += 1
        if self._consecutive_failures >= _BREAKER_THRESHOLD:
            self._breaker_open_until = time.monotonic() + _BREAKER_COOLDOWN_SECS
            logger.warning("Mem0 circuit breaker tripped — pausing for %ds.", _BREAKER_COOLDOWN_SECS)

    def initialize(self, session_id: str, **kwargs) -> None:
        self._config = _load_config()
        if self._config.get("base_url"):
            self._mode = "self-hosted"
            logger.info("Mem0 provider: self-hosted at %s", self._config["base_url"])
        else:
            self._mode = "cloud"
            logger.info("Mem0 provider: cloud (API key)")
        self._user_id = kwargs.get("user_id") or self._config.get("user_id", "hermes-user")
        self._agent_id = self._config.get("agent_id", "hermes")
        self._rerank = self._config.get("rerank", True)

    @staticmethod
    def _unwrap(response: Any) -> list:
        if isinstance(response, dict):
            return response.get("results", [])
        if isinstance(response, list):
            return response
        return []

    def system_prompt_block(self) -> str:
        mode = f"self-hosted ({self._config.get('base_url', '')})" if self._mode == "self-hosted" else "cloud"
        return (
            f"# Mem0 Memory [{mode}]\n"
            f"Active. User: {self._user_id}.\n"
            "Use mem0_search to find memories, mem0_conclude to store facts, "
            "mem0_profile for a full overview."
        )

    def prefetch(self, query: str, *, session_id: str = "") -> str:
        if self._prefetch_thread and self._prefetch_thread.is_alive():
            self._prefetch_thread.join(timeout=3.0)
        with self._prefetch_lock:
            result = self._prefetch_result
            self._prefetch_result = ""
        return f"## Mem0 Memory\n{result}" if result else ""

    def queue_prefetch(self, query: str, *, session_id: str = "") -> None:
        if self._is_breaker_open():
            return

        def _run():
            try:
                client = self._get_client()
                results = self._unwrap(client.search(
                    query=query, user_id=self._user_id, top_k=5,
                ))
                if results:
                    lines = [r.get("memory", "") for r in results if r.get("memory")]
                    with self._prefetch_lock:
                        self._prefetch_result = "\n".join(f"- {l}" for l in lines)
                self._record_success()
            except Exception as e:
                self._record_failure()
                logger.debug("Mem0 prefetch failed: %s", e)

        self._prefetch_thread = threading.Thread(target=_run, daemon=True, name="mem0-prefetch")
        self._prefetch_thread.start()

    def sync_turn(self, user_content: str, assistant_content: str, *, session_id: str = "") -> None:
        if self._is_breaker_open():
            return

        def _sync():
            try:
                client = self._get_client()
                client.add(
                    [{"role": "user", "content": user_content},
                     {"role": "assistant", "content": assistant_content}],
                    user_id=self._user_id,
                    agent_id=self._agent_id,
                )
                self._record_success()
            except Exception as e:
                self._record_failure()
                logger.warning("Mem0 sync failed: %s", e)

        if self._sync_thread and self._sync_thread.is_alive():
            self._sync_thread.join(timeout=5.0)
        self._sync_thread = threading.Thread(target=_sync, daemon=True, name="mem0-sync")
        self._sync_thread.start()

    def on_memory_write(self, action: str, target: str, content: str,
                        metadata: Optional[Dict[str, Any]] = None) -> None:
        """Mirror built-in memory writes to mem0."""
        if self._is_breaker_open() or action not in ("add", "replace"):
            return

        def _mirror():
            try:
                client = self._get_client()
                client.add(
                    [{"role": "user", "content": content}],
                    user_id=self._user_id,
                    agent_id=self._agent_id,
                    infer=False,
                )
                self._record_success()
            except Exception as e:
                self._record_failure()
                logger.debug("Mem0 mirror write failed: %s", e)

        threading.Thread(target=_mirror, daemon=True, name="mem0-mirror").start()

    def get_tool_schemas(self) -> List[Dict[str, Any]]:
        return [PROFILE_SCHEMA, SEARCH_SCHEMA, CONCLUDE_SCHEMA]

    def handle_tool_call(self, tool_name: str, args: dict, **kwargs) -> str:
        if self._is_breaker_open():
            return json.dumps({"error": "Mem0 temporarily unavailable — will retry automatically."})

        try:
            client = self._get_client()
        except Exception as e:
            return tool_error(str(e))

        if tool_name == "mem0_profile":
            try:
                items = self._unwrap(client.get_all(user_id=self._user_id))
                self._record_success()
                if not items:
                    return json.dumps({"result": "No memories stored yet."})
                lines = [m.get("memory", "") for m in items if m.get("memory")]
                return json.dumps({"result": "\n".join(lines), "count": len(lines)})
            except Exception as e:
                self._record_failure()
                return tool_error(f"Failed to fetch profile: {e}")

        if tool_name == "mem0_search":
            query = args.get("query", "")
            if not query:
                return tool_error("query is required")
            top_k = min(int(args.get("top_k", 10)), 50)
            try:
                items = self._unwrap(client.search(
                    query=query, user_id=self._user_id, top_k=top_k,
                ))
                self._record_success()
                if not items:
                    return json.dumps({"result": "No relevant memories found."})
                return json.dumps({
                    "results": [{"memory": r.get("memory", ""), "score": r.get("score", 0)} for r in items],
                    "count": len(items),
                })
            except Exception as e:
                self._record_failure()
                return tool_error(f"Search failed: {e}")

        if tool_name == "mem0_conclude":
            conclusion = args.get("conclusion", "")
            if not conclusion:
                return tool_error("conclusion is required")
            try:
                client.add(
                    [{"role": "user", "content": conclusion}],
                    user_id=self._user_id,
                    agent_id=self._agent_id,
                    infer=False,
                )
                self._record_success()
                return json.dumps({"result": "Fact stored."})
            except Exception as e:
                self._record_failure()
                return tool_error(f"Failed to store: {e}")

        return tool_error(f"Unknown tool: {tool_name}")

    def shutdown(self) -> None:
        for t in (self._prefetch_thread, self._sync_thread):
            if t and t.is_alive():
                t.join(timeout=5.0)
        with self._client_lock:
            self._client = None


def register(ctx) -> None:
    ctx.register_memory_provider(Mem0MemoryProvider())
