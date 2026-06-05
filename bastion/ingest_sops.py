"""Ingest SOP markdown files into the pgvector `bastion_sops` table.

Run once at setup and whenever the sop/*.md files change:
    python bastion/ingest_sops.py
"""

from __future__ import annotations

import glob
import logging
import os

from db import connect
from embeddings import embed, to_pgvector

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
log = logging.getLogger(__name__)

SOP_DIR = os.path.join(os.path.dirname(__file__), "sop")

UPSERT = """
INSERT INTO bastion_sops (id, title, body, embedding)
VALUES (%s, %s, %s, %s::vector)
ON CONFLICT (id) DO UPDATE
  SET title = EXCLUDED.title,
      body = EXCLUDED.body,
      embedding = EXCLUDED.embedding
"""


def title_of(body: str, fallback: str) -> str:
    for line in body.splitlines():
        if line.startswith("# "):
            return line[2:].strip()
    return fallback


def main() -> None:
    conn = connect()
    files = sorted(glob.glob(os.path.join(SOP_DIR, "*.md")))
    if not files:
        log.warning("no SOP files found in %s", SOP_DIR)
        return
    for path in files:
        sop_id = os.path.splitext(os.path.basename(path))[0]
        with open(path, encoding="utf-8") as fh:
            body = fh.read()
        title = title_of(body, sop_id)
        vec = to_pgvector(embed(body))
        with conn.cursor() as cur:
            cur.execute(UPSERT, (sop_id, title, body, vec))
        log.info("ingested %s — %s", sop_id, title)
    log.info("done: %d SOPs", len(files))


if __name__ == "__main__":
    main()
