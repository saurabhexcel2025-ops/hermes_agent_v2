"""Shared Postgres helpers for the Bastion daemons.

Connects to the same hermes_auth DB the rest of the stack uses (separate tables
from Sentinel). Honours DATABASE_URL if present, otherwise builds the DSN from
the POSTGRES_* env vars (the same ones docker-compose passes to mem0-server).
"""

from __future__ import annotations

import os

import psycopg2


def dsn() -> str:
    url = os.environ.get("DATABASE_URL")
    if url:
        return url
    host = os.environ.get("POSTGRES_HOST", "postgres")
    port = os.environ.get("POSTGRES_PORT", "5432")
    db = os.environ.get("POSTGRES_DB", "hermes_auth")
    user = os.environ.get("POSTGRES_USER", "hermes")
    pw = os.environ.get("POSTGRES_PASSWORD", "")
    return f"host={host} port={port} dbname={db} user={user} password={pw}"


def connect():
    conn = psycopg2.connect(dsn())
    conn.autocommit = True
    return conn
