"""Embeddings helper — Ollama Cloud (consistent with the rest of the stack).

Reasoning (glm-5) already runs on Ollama Cloud; SOP embeddings use it too. We
call the OpenAI-compatible /v1/embeddings endpoint with the same cloud key the
mem0-server container already receives (OLLAMA_CLOUD_API_KEY).

Note: this is the SOP store only. mem0's own internal embedder (its 384-dim
mem0_memories collection) is unchanged — that is mem0's config, not ours.
"""

from __future__ import annotations

import json
import os
import urllib.request

BASE_URL = os.environ.get("OLLAMA_CLOUD_BASE_URL", "https://ollama.com/v1")
API_KEY = os.environ.get("OLLAMA_CLOUD_API_KEY") or os.environ.get("OLLAMA_API_KEY", "")
EMBED_MODEL = os.environ.get("SENTINEL_EMBED_MODEL", "nomic-embed-text")
EMBED_DIMS = 768  # nomic-embed-text


def embed(text: str) -> list[float]:
    payload = json.dumps({"model": EMBED_MODEL, "input": text}).encode()
    req = urllib.request.Request(
        f"{BASE_URL}/embeddings",
        data=payload,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {API_KEY}",
        },
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        data = json.loads(resp.read())
    return data["data"][0]["embedding"]


def to_pgvector(vec: list[float]) -> str:
    """Format a vector for a pgvector literal: '[0.1,0.2,...]'."""
    return "[" + ",".join(f"{x:.6f}" for x in vec) + "]"
