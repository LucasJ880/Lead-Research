"""Celery tasks for crawling sources."""

from __future__ import annotations

from typing import Any

from sqlalchemy import text

from src.core.database import get_db
from src.core.logging import get_logger
from src.models.opportunity import AccessMode, CrawlResult, SourceConfig, SourceType, CrawlFrequency
from src.tasks.celery_app import celery_app

logger = get_logger(__name__)


def _row_to_source_config(row: Any) -> SourceConfig:
    """Convert a database row to a SourceConfig model."""
    raw_access = getattr(row, "access_mode", "http") or "http"
    try:
        access_mode = AccessMode(raw_access)
    except ValueError:
        access_mode = AccessMode.HTTP

    return SourceConfig(
        id=str(row.id),
        name=row.name,
        source_type=SourceType(row.source_type),
        base_url=row.base_url,
        country=row.country,
        region=row.region,
        city=row.city,
        crawl_config=row.crawl_config if row.crawl_config else {},
        access_mode=access_mode,
        frequency=CrawlFrequency(row.frequency),
        is_active=row.is_active,
        category_tags=row.category_tags if row.category_tags else [],
        industry_fit_score=row.industry_fit_score if hasattr(row, "industry_fit_score") else 50,
        source_priority=row.source_priority if hasattr(row, "source_priority") else "medium",
        listing_path=row.listing_path if hasattr(row, "listing_path") else None,
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

    Sources with access_mode='local_authenticated_connector' are skipped —
    those are handled by the local agent, not the cloud worker.
    """
    logger.info("Dispatching crawl tasks for all active sources")
    task_ids: list[dict[str, str]] = []
    skipped_local: list[str] = []

    with get_db() as session:
        rows = session.execute(
            text("SELECT id, name, access_mode FROM sources WHERE is_active = true")
        ).fetchall()

    for row in rows:
        access = getattr(row, "access_mode", "http") or "http"
        if access == "local_authenticated_connector":
            skipped_local.append(row.name)
            logger.info("Skipping local-agent source: %s", row.name)
            continue

        source_id = str(row.id)
        task = crawl_source.delay(source_id)
        task_ids.append({"source_id": source_id, "task_id": task.id})
        logger.info("Dispatched crawl task %s for source %s (%s)", task.id, source_id, row.name)

    logger.info("Dispatched %d crawl tasks (skipped %d local-agent sources)", len(task_ids), len(skipped_local))
    return {"dispatched": task_ids, "count": len(task_ids), "skipped_local_agent": skipped_local}


# Tier thresholds for industry_fit_score
_TIER_RANGES = {
    "high": (60, 100),
    "medium": (30, 59),
    "low": (0, 29),
}


@celery_app.task(name="src.tasks.crawl_tasks.crawl_by_fit_tier")
def crawl_by_fit_tier(tier: str) -> dict[str, Any]:
    """Crawl only sources in a specific industry-fit tier.

    Args:
        tier: one of 'high', 'medium', 'low'
    """
    lo, hi = _TIER_RANGES.get(tier, (0, 100))
    logger.info("Dispatching crawl tasks for tier=%s (fit_score %d-%d)", tier, lo, hi)
    task_ids: list[dict[str, str]] = []

    with get_db() as session:
        rows = session.execute(
            text(
                "SELECT id, name, industry_fit_score FROM sources "
                "WHERE is_active = true "
                "AND industry_fit_score >= :lo AND industry_fit_score <= :hi"
            ),
            {"lo": lo, "hi": hi},
        ).fetchall()

    for row in rows:
        source_id = str(row.id)
        task = crawl_source.delay(source_id)
        task_ids.append({"source_id": source_id, "task_id": task.id})
        logger.info(
            "Dispatched [%s] crawl for %s (fit=%d)", tier, row.name, row.industry_fit_score
        )

    logger.info("Tier %s: dispatched %d crawl tasks", tier, len(task_ids))
    return {"tier": tier, "dispatched": task_ids, "count": len(task_ids)}
