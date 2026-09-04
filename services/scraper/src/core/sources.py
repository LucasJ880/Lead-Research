"""Helpers for turning ``sources`` rows into ``SourceConfig`` objects."""

from __future__ import annotations

from typing import Any

from src.models.opportunity import AccessMode, CrawlFrequency, SourceConfig, SourceType

# Sources handled by a local (desktop) connector rather than the cloud crawler.
LOCAL_ACCESS_MODES = ("local_connector", "local_authenticated_connector")


def row_to_source_config(row: Any) -> SourceConfig:
    """Build a SourceConfig from a ``SELECT * FROM sources`` row."""
    raw_access = getattr(row, "access_mode", None) or "http"
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
