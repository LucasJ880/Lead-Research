"""Celery tasks for translating high-relevance opportunities to Chinese."""

from __future__ import annotations

from typing import Any

from src.core.database import get_db
from src.core.logging import get_logger
from src.tasks.celery_app import celery_app
from src.utils.translator import translate_pending_batch

logger = get_logger(__name__)


@celery_app.task(name="src.tasks.translate_tasks.translate_pending_opportunities")
def translate_pending_opportunities() -> dict[str, Any]:
    """Batch-translate high-relevance opportunities that lack Chinese translations.

    Catches historical records and any that failed inline translation.
    """
    logger.info("Starting batch translation of pending opportunities")
    try:
        with get_db() as session:
            count = translate_pending_batch(session, limit=50)
        logger.info("Batch translation finished: %d opportunities translated", count)
        return {"translated": count}
    except Exception as exc:
        logger.exception("Batch translation task failed")
        return {"error": str(exc), "translated": 0}
