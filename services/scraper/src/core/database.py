"""SQLAlchemy engine and session management.

On serverless hosts (Vercel) every invocation may run in a fresh process, so
a persistent connection pool is wasted and can exhaust the database's
connection limit under cron fan-out. There we use ``NullPool`` (one short-lived
connection per session) and rely on the provider's pooler (e.g. the Neon
``-pooler`` endpoint) for multiplexing.
"""

from __future__ import annotations

import os
from contextlib import contextmanager
from typing import Generator
from urllib.parse import parse_qs, urlencode, urlparse, urlunparse

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import NullPool

from src.core.config import settings

# Query params understood by Prisma but rejected by libpq/psycopg2.
_PRISMA_ONLY_PARAMS = ("schema", "connection_limit", "pool_timeout", "pgbouncer", "connect_timeout_ms")

IS_SERVERLESS = bool(os.environ.get("VERCEL") or os.environ.get("AWS_LAMBDA_FUNCTION_NAME"))


def _clean_database_url(url: str) -> str:
    """Strip Prisma-specific query params (like ?schema=public) that psycopg2 rejects."""
    parsed = urlparse(url)
    params = parse_qs(parsed.query)
    for key in _PRISMA_ONLY_PARAMS:
        params.pop(key, None)
    clean_query = urlencode(params, doseq=True)
    return urlunparse(parsed._replace(query=clean_query))


if IS_SERVERLESS:
    engine = create_engine(
        _clean_database_url(settings.DATABASE_URL),
        poolclass=NullPool,
        pool_pre_ping=True,
    )
else:
    engine = create_engine(
        _clean_database_url(settings.DATABASE_URL),
        pool_size=5,
        max_overflow=10,
        pool_pre_ping=True,
    )

SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)


@contextmanager
def get_db() -> Generator[Session, None, None]:
    """Yield a database session and ensure it is closed afterwards.

    Usage::

        with get_db() as session:
            session.execute(...)
    """
    session = SessionLocal()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def get_db_session() -> Session:
    """Return a raw session. Caller is responsible for commit/close."""
    return SessionLocal()
