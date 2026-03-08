"""Deduplication utilities for opportunity records."""

from __future__ import annotations

import hashlib

from sqlalchemy import text
from sqlalchemy.orm import Session

from src.core.logging import get_logger

logger = get_logger(__name__)


def generate_fingerprint(
    title: str,
    org_name: str,
    closing_date: str,
    source_url: str,
) -> str:
    """Create a deterministic SHA-256 fingerprint for an opportunity.

    Args:
        title: Opportunity title.
        org_name: Issuing organization name.
        closing_date: Closing / deadline date as a string.
        source_url: Original source URL.

    Returns:
        64-character hex digest.
    """
    parts = [
        (title or "").strip().lower(),
        (org_name or "").strip().lower(),
        (closing_date or "").strip().lower(),
        (source_url or "").strip().lower(),
    ]
    raw = "|".join(parts)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def check_duplicate(session: Session, fingerprint: str) -> str | None:
    """Look up an existing opportunity by its fingerprint.

    Args:
        session: Active SQLAlchemy session.
        fingerprint: SHA-256 fingerprint to search for.

    Returns:
        The opportunity ``id`` if a duplicate exists, otherwise ``None``.
    """
    row = session.execute(
        text("SELECT id FROM opportunities WHERE fingerprint = :fp"),
        {"fp": fingerprint},
    ).fetchone()

    if row:
        logger.debug("Duplicate found for fingerprint %s: %s", fingerprint[:12], row.id)
        return str(row.id)
    return None


def check_source_duplicate(
    session: Session,
    source_id: str,
    external_id: str,
) -> str | None:
    """Look up an existing opportunity by source + external ID.

    Args:
        session: Active SQLAlchemy session.
        source_id: UUID of the source.
        external_id: The external ID assigned by the source website.

    Returns:
        The opportunity ``id`` if found, otherwise ``None``.
    """
    if not external_id:
        return None

    row = session.execute(
        text(
            "SELECT id FROM opportunities "
            "WHERE source_id = :sid AND external_id = :eid"
        ),
        {"sid": source_id, "eid": external_id},
    ).fetchone()

    if row:
        logger.debug(
            "Source duplicate found: source=%s external=%s → %s",
            source_id,
            external_id,
            row.id,
        )
        return str(row.id)
    return None
