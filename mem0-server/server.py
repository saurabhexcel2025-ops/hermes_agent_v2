"""Self-hosted mem0 memory server — Ollama + pgvector + Neo4j."""

from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ── Config ────────────────────────────────────────────────────────────────────

OLLAMA_CLOUD_API_KEY = os.getenv("OLLAMA_CLOUD_API_KEY", "")
OLLAMA_CLOUD_BASE_URL = os.getenv("OLLAMA_CLOUD_BASE_URL", "https://ollama.com/v1")
OLLAMA_LLM_MODEL = os.getenv("OLLAMA_LLM_MODEL", "glm-5")
OLLAMA_EMBED_MODEL = os.getenv("OLLAMA_EMBED_MODEL", "nomic-embed-text")

POSTGRES_HOST = os.getenv("POSTGRES_HOST", "postgres")
POSTGRES_PORT = int(os.getenv("POSTGRES_PORT", "5432"))
POSTGRES_DB = os.getenv("POSTGRES_DB", "hermes_auth")
POSTGRES_USER = os.getenv("POSTGRES_USER", "hermes")
POSTGRES_PASSWORD = os.getenv("POSTGRES_PASSWORD", "hermes_pass")

NEO4J_URL = os.getenv("NEO4J_URL", "bolt://neo4j:7687")
NEO4J_USER = os.getenv("NEO4J_USER", "neo4j")
NEO4J_PASSWORD = os.getenv("NEO4J_PASSWORD", "mem0_password")

ENABLE_GRAPH = os.getenv("ENABLE_GRAPH", "true").lower() == "true"

# Ollama Cloud is OpenAI-compatible. Set OPENAI_API_KEY + OPENAI_BASE_URL so
# mem0ai's openai provider picks them up automatically from the environment.
os.environ.setdefault("OPENAI_API_KEY", OLLAMA_CLOUD_API_KEY)
os.environ.setdefault("OPENAI_BASE_URL", OLLAMA_CLOUD_BASE_URL)

MEM0_CONFIG: Dict[str, Any] = {
    "llm": {
        "provider": "openai",
        "config": {
            "model": OLLAMA_LLM_MODEL,
            "temperature": 0,
            "max_tokens": 2000,
        },
    },
    "embedder": {
        "provider": "huggingface",
        "config": {
            "model": "multi-qa-MiniLM-L6-cos-v1",
            "embedding_dims": 384,
        },
    },
    "vector_store": {
        "provider": "pgvector",
        "config": {
            "host": POSTGRES_HOST,
            "port": POSTGRES_PORT,
            "dbname": POSTGRES_DB,
            "user": POSTGRES_USER,
            "password": POSTGRES_PASSWORD,
            "collection_name": "mem0_memories",
            "embedding_model_dims": 384,
        },
    },
    "version": "v1.1",
}

if ENABLE_GRAPH:
    MEM0_CONFIG["graph_store"] = {
        "provider": "neo4j",
        "config": {
            "url": NEO4J_URL,
            "username": NEO4J_USER,
            "password": NEO4J_PASSWORD,
        },
    }

# ── App lifecycle ─────────────────────────────────────────────────────────────

_memory = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _memory
    from mem0 import Memory
    logger.info("Initializing mem0 Memory (Ollama + pgvector%s)...", " + Neo4j" if ENABLE_GRAPH else "")
    _memory = Memory.from_config(MEM0_CONFIG)
    logger.info("mem0 ready")
    yield
    logger.info("mem0 server shutting down")


app = FastAPI(title="Hermes Mem0 Server", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Request/response models ───────────────────────────────────────────────────


class Message(BaseModel):
    role: str
    content: str


class AddMemoriesRequest(BaseModel):
    messages: List[Message]
    user_id: str = "hermes-user"
    agent_id: Optional[str] = "hermes"
    infer: bool = True
    metadata: Optional[Dict[str, Any]] = None


class UpdateMemoryRequest(BaseModel):
    data: str


# ── Helpers ───────────────────────────────────────────────────────────────────


def _unwrap(response: Any) -> list:
    if isinstance(response, dict):
        return response.get("results", [])
    if isinstance(response, list):
        return response
    return []


def _require_memory():
    if _memory is None:
        raise HTTPException(status_code=503, detail="mem0 not initialized yet")
    return _memory


# ── Routes ────────────────────────────────────────────────────────────────────


@app.get("/health")
def health():
    return {"status": "ok" if _memory else "initializing", "provider": "mem0-self-hosted"}


@app.post("/v1/memories")
def add_memories(req: AddMemoriesRequest):
    m = _require_memory()
    try:
        kwargs: Dict[str, Any] = {"user_id": req.user_id}
        if req.metadata:
            kwargs["metadata"] = req.metadata
        if not req.infer:
            kwargs["infer"] = False
        result = m.add([msg.dict() for msg in req.messages], **kwargs)
        items = _unwrap(result)
        return {"results": items, "count": len(items)}
    except Exception as e:
        logger.error("add_memories failed: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/v1/memories")
def list_memories(
    user_id: str = Query("hermes-user"),
    search: Optional[str] = Query(None),
    limit: int = Query(100),
):
    m = _require_memory()
    try:
        if search:
            result = m.search(query=search, filters={"user_id": user_id}, limit=limit)
        else:
            result = m.get_all(filters={"user_id": user_id})
        items = _unwrap(result)
        return {"results": items, "total": len(items)}
    except Exception as e:
        logger.error("list_memories failed: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/v1/memories/search")
def search_memories(
    query: str = Query(...),
    user_id: str = Query("hermes-user"),
    top_k: int = Query(10),
):
    m = _require_memory()
    try:
        result = m.search(query=query, filters={"user_id": user_id}, limit=top_k)
        items = _unwrap(result)
        return {"results": items, "count": len(items)}
    except Exception as e:
        logger.error("search_memories failed: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


@app.put("/v1/memories/{memory_id}")
def update_memory(memory_id: str, req: UpdateMemoryRequest):
    m = _require_memory()
    try:
        m.update(memory_id=memory_id, data=req.data)
        return {"success": True, "id": memory_id}
    except Exception as e:
        logger.error("update_memory failed: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/v1/memories/{memory_id}")
def delete_memory(memory_id: str):
    m = _require_memory()
    try:
        m.delete(memory_id=memory_id)
        return {"success": True, "id": memory_id}
    except Exception as e:
        logger.error("delete_memory failed: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/v1/memories")
def delete_all_memories(user_id: str = Query("hermes-user")):
    m = _require_memory()
    try:
        m.delete_all(user_id=user_id)
        return {"success": True}
    except Exception as e:
        logger.error("delete_all failed: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", "8888")), log_level="info")
