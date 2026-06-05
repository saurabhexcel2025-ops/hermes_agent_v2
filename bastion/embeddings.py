"""Embeddings helper — local model, the SAME one mem0-server / Sentinel use.

Ollama Cloud serves chat (glm-5) but NOT embeddings, so embeddings run locally
in-process. Reuses mem0's exact embedder (HuggingFace
`multi-qa-MiniLM-L6-cos-v1`, 384 dims), already installed in the mem0-server
image. This backs Bastion's own `bastion_sops` table only.
"""

from __future__ import annotations

import os
import threading

EMBED_MODEL = os.environ.get("BASTION_EMBED_MODEL", "multi-qa-MiniLM-L6-cos-v1")
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
