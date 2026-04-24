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
        result["deleted"] = int(deleted or 0)

    logger.info("Purged %d expired opportunities older than %d days", result["deleted"], retention_days)
    return result


@celery_app.task(name="src.tasks.cleanup_tasks.purge_expired_opportunities")
def purge_expired_opportunities() -> dict[str, Any]:
    """Celery wrapper for the daily expired-opportunity purge."""
    return purge_expired_opportunities_now()
