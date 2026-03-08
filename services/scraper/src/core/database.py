"""SQLAlchemy engine and session management."""

from contextlib import contextmanager
from typing import Generator
from urllib.parse import urlparse, urlunparse, parse_qs, urlencode

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from src.core.config import settings


def _clean_database_url(url: str) -> str:
    """Strip Prisma-specific query params (like ?schema=public) that psycopg2 rejects."""
    parsed = urlparse(url)
    params = parse_qs(parsed.query)
    params.pop("schema", None)
    clean_query = urlencode(params, doseq=True)
    return urlunparse(parsed._replace(query=clean_query))


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
