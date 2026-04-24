"""Maintenance tasks for keeping opportunity data focused and current."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import text

from src.core.database import get_db
from src.core.logging import get_logger
from src.tasks.celery_app import celery_app

logger = get_logger(__name__)

EXPIRED_RETENTION_DAYS = 14
_UNRESTRICTED_SET_ASIDE_VALUES = {
    "",
    "none",
    "null",
    "n/a",
    "na",
    "no set aside used",
    "no set-aside used",
}


def _is_unrestricted_set_aside(value: str | None) -> bool:
    parts = [part.strip().lower() for part in (value or "").split(";")]
    return all(part in _UNRESTRICTED_SET_ASIDE_VALUES for part in parts)


def _delete_opportunity_ids(session: Any, opportunity_ids: list[str]) -> int:
    if not opportunity_ids:
        return 0

    session.execute(
        text("DELETE FROM tender_intelligence WHERE opportunity_id = ANY(CAST(:ids AS uuid[]))"),
        {"ids": opportunity_ids},
    )
    session.execute(
        text("DELETE FROM opportunity_documents WHERE opportunity_id = ANY(CAST(:ids AS uuid[]))"),
        {"ids": opportunity_ids},
    )
    session.execute(
        text("DELETE FROM notes WHERE opportunity_id = ANY(CAST(:ids AS uuid[]))"),
        {"ids": opportunity_ids},
    )
    session.execute(
        text("DELETE FROM opportunity_tags WHERE opportunity_id = ANY(CAST(:ids AS uuid[]))"),
        {"ids": opportunity_ids},
    )
    session.execute(
        text("DELETE FROM qingyan_sync WHERE opportunity_id = ANY(CAST(:ids AS uuid[]))"),
        {"ids": opportunity_ids},
    )
    session.execute(
        text("UPDATE alerts SET opportunity_id = NULL WHERE opportunity_id = ANY(CAST(:ids AS uuid[]))"),
        {"ids": opportunity_ids},
    )
    deleted = session.execute(
        text("DELETE FROM opportunities WHERE id = ANY(CAST(:ids AS uuid[]))"),
        {"ids": opportunity_ids},
    ).rowcount
    return int(deleted or 0)


def purge_sam_set_aside_restricted_now() -> dict[str, Any]:
    """Delete legacy SAM.gov opportunities that require US/special set-aside eligibility."""
    with get_db() as session:
        rows = session.execute(
            text("""
                SELECT o.id,
                       COALESCE(o.set_aside, o.raw_data->>'set_aside', '') AS set_aside,
                       COALESCE(o.set_aside_restricted, false) AS set_aside_restricted,
                       COALESCE((o.raw_data->>'set_aside_restricted')::boolean, false) AS raw_restricted
                FROM opportunities o
                JOIN sources s ON s.id = o.source_id
                WHERE s.name = 'SAM.gov'
            """)
        ).fetchall()
        blocked_ids = [
            str(row.id)
            for row in rows
            if row.set_aside_restricted or row.raw_restricted or not _is_unrestricted_set_aside(row.set_aside)
        ]
        deleted = _delete_opportunity_ids(session, blocked_ids)

    logger.info("Purged %d SAM.gov set-aside restricted opportunities", deleted)
    return {"deleted": deleted}


def purge_expired_opportunities_now(retention_days: int = EXPIRED_RETENTION_DAYS) -> dict[str, Any]:
    """Delete opportunities that expired more than retention_days ago.

    We physically remove old opportunities so the dashboard stays focused on
    actionable work. Related documents and AI reports are explicitly deleted
    first for compatibility with databases that do not have all FK cascades.
    """
    cutoff = datetime.now(timezone.utc) - timedelta(days=retention_days)
    result: dict[str, Any] = {"cutoff": cutoff.isoformat(), "deleted": 0}

    with get_db() as session:
        candidate_rows = session.execute(
            text("""
                SELECT id
                FROM opportunities
                WHERE closing_date IS NOT NULL
                  AND closing_date < :cutoff
            """),
            {"cutoff": cutoff},
        ).fetchall()

        opportunity_ids = [str(row.id) for row in candidate_rows]
        if not opportunity_ids:
            return result

        result["deleted"] = _delete_opportunity_ids(session, opportunity_ids)

    logger.info("Purged %d expired opportunities older than %d days", result["deleted"], retention_days)
    return result


@celery_app.task(name="src.tasks.cleanup_tasks.purge_expired_opportunities")
def purge_expired_opportunities() -> dict[str, Any]:
    """Celery wrapper for daily maintenance cleanup."""
    expired = purge_expired_opportunities_now()
    set_aside = purge_sam_set_aside_restricted_now()
    return {"expired": expired, "sam_set_aside_restricted": set_aside}
