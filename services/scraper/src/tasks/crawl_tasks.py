"""Celery tasks for crawling sources."""

from __future__ import annotations

from typing import Any

from sqlalchemy import text

from src.core.database import get_db
from src.core.logging import get_logger
from src.models.opportunity import CrawlResult, SourceConfig, SourceType, CrawlFrequency
from src.tasks.celery_app import celery_app

logger = get_logger(__name__)


def _row_to_source_config(row: Any) -> SourceConfig:
    """Convert a database row to a SourceConfig model."""
    return SourceConfig(
        id=str(row.id),
        name=row.name,
        source_type=SourceType(row.source_type),
        base_url=row.base_url,
        country=row.country,
        region=row.region,
        city=row.city,
        crawl_config=row.crawl_config if row.crawl_config else {},
        frequency=CrawlFrequency(row.frequency),
        is_active=row.is_active,
        category_tags=row.category_tags if row.category_tags else [],
    )


@celery_app.task(
    bind=True,
    name="src.tasks.crawl_tasks.crawl_source",
    max_retries=2,
    default_retry_delay=60,
)
def crawl_source(self: Any, source_id: str) -> dict[str, Any]:
    """Run the full crawl pipeline for a single source.

    Args:
        source_id: UUID of the source to crawl.

    Returns:
        Serialized CrawlResult dict.
    """
    logger.info("Starting crawl for source %s", source_id)

    try:
        with get_db() as session:
            row = session.execute(
                text("SELECT * FROM sources WHERE id = :id"),
                {"id": source_id},
            ).fetchone()

            if row is None:
                logger.error("Source %s not found", source_id)
                return CrawlResult(
                    source_id=source_id,
                    errors=[f"Source {source_id} not found"],
                ).model_dump()

            source_config = _row_to_source_config(row)

        from src.crawlers.pipeline import CrawlPipeline

        with get_db() as session:
            pipeline = CrawlPipeline(source_config=source_config, db_session=session)
            result = pipeline.run()

        logger.info(
            "Crawl complete for source %s: found=%d created=%d updated=%d skipped=%d errors=%d",
            source_id,
            result.opportunities_found,
            result.opportunities_created,
            result.opportunities_updated,
            result.opportunities_skipped,
            len(result.errors),
        )
        return result.model_dump()

    except Exception as exc:
        logger.exception("Crawl failed for source %s", source_id)
        try:
            self.retry(exc=exc)
        except self.MaxRetriesExceededError:
            return CrawlResult(
                source_id=source_id,
                errors=[str(exc)],
            ).model_dump()
        raise


@celery_app.task(name="src.tasks.crawl_tasks.crawl_all_active_sources")
def crawl_all_active_sources() -> dict[str, Any]:
    """Query all active sources and dispatch individual crawl tasks.

    Returns:
        Dict with a list of dispatched task IDs.
    """
    logger.info("Dispatching crawl tasks for all active sources")
    task_ids: list[dict[str, str]] = []

    with get_db() as session:
        rows = session.execute(
            text("SELECT id, name FROM sources WHERE is_active = true")
        ).fetchall()

    for row in rows:
        source_id = str(row.id)
        task = crawl_source.delay(source_id)
        task_ids.append({"source_id": source_id, "task_id": task.id})
        logger.info("Dispatched crawl task %s for source %s (%s)", task.id, source_id, row.name)

    logger.info("Dispatched %d crawl tasks", len(task_ids))
    return {"dispatched": task_ids, "count": len(task_ids)}
