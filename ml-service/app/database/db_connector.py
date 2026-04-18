"""Thin Postgres helper used by the ML service.

We keep it synchronous (psycopg2) for simplicity - the workloads are short
analytical queries against TimescaleDB, not high-throughput transactions.
"""
from __future__ import annotations

from contextlib import contextmanager
from typing import Iterable, Sequence, Any
import logging
import time

import psycopg2
import psycopg2.extras

from ..config import settings

logger = logging.getLogger(__name__)


def _connect(retries: int = 20, delay: float = 2.0):
    last = None
    for i in range(retries):
        try:
            return psycopg2.connect(settings.database_url)
        except Exception as exc:  # pragma: no cover
            last = exc
            logger.warning("db not ready (%d/%d): %s", i + 1, retries, exc)
            time.sleep(delay)
    raise RuntimeError(f"Postgres unreachable: {last}")


@contextmanager
def get_conn():
    conn = _connect()
    try:
        yield conn
    finally:
        conn.close()


def fetch_all(sql: str, params: Sequence[Any] | None = None) -> list[dict]:
    with get_conn() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(sql, params or ())
            return [dict(r) for r in cur.fetchall()]


def fetch_one(sql: str, params: Sequence[Any] | None = None) -> dict | None:
    rows = fetch_all(sql, params)
    return rows[0] if rows else None


def execute(sql: str, params: Sequence[Any] | None = None) -> int:
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params or ())
            conn.commit()
            return cur.rowcount


def wait_ready() -> None:
    """Block until the DB responds to SELECT 1."""
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT 1")
            cur.fetchone()
