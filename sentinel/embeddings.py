"""Embeddings helper — local model, the SAME one mem0-server uses.

NOTE on "Ollama Cloud everywhere": the Ollama Cloud account serves chat models
(glm-5) but NOT embeddings — /api/embed returns 401 and /v1/embeddings 404 with
the same key that works for chat. So embeddings must run locally. We reuse mem0's
exact embedder (HuggingFace `multi-qa-MiniLM-L6-cos-v1`, 384 dims), which is
already installed in the mem0-server image — no extra service, no extra download.

This is the SOP store only; mem0's own memory embeddings are unchanged.
Reasoning (glm-5) still runs on Ollama Cloud.
"""

from __future__ import annotations

import os
import threading

EMBED_MODEL = os.environ.get("SENTINEL_EMBED_MODEL", "multi-qa-MiniLM-L6-cos-v1")
EMBED_DIMS = 384

_model = None
_lock = threading.Lock()


def _get_model():
    global _model
    if _model is None:
        with _lock:
            if _model is None:
                from sentence_transformers import SentenceTransformer
                _model = SentenceTransformer(EMBED_MODEL)
    return _model


def embed(text: str) -> list[float]:
    vec = _get_model().encode(text, normalize_embeddings=True)
    return vec.tolist()


def to_pgvector(vec: list[float]) -> str:
    """Format a vector for a pgvector literal: '[0.1,0.2,...]'."""
    return "[" + ",".join(f"{x:.6f}" for x in vec) + "]"
