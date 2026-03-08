#!/usr/bin/env python3
"""CLI entry point for running the LeadHarvest crawl pipeline.

Usage:
    python run_pipeline.py                     # Run all active sources
    python run_pipeline.py --source sam_gov    # Run a specific source
    python run_pipeline.py --setup-sources     # Register demo sources in DB
    python run_pipeline.py --status            # Show current source status
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone

from sqlalchemy import text

from src.core.config import settings
from src.core.database import get_db
from src.core.logging import get_logger
from src.crawlers.pipeline import CrawlPipeline
from src.models.opportunity import CrawlFrequency, SourceConfig, SourceType, TriggerType

logger = get_logger("run_pipeline")

DEMO_SOURCES = [
    {
        "name": "SAM.gov — US Federal Procurement",
        "source_type": "bid_portal",
        "base_url": "https://sam.gov",
        "country": "US",
        "region": None,
        "frequency": "daily",
        "is_active": True,
        "category_tags": ["government", "federal", "construction", "renovation"],
        "crawl_config": {
            "crawler_class": "sam_gov",
            "max_pages": 5,
            "rate_limit_seconds": 3,
        },
    },
    {
        "name": "Canadian Federal Procurement",
        "source_type": "bid_portal",
        "base_url": "https://buyandsell.gc.ca",
        "country": "CA",
        "region": None,
        "frequency": "daily",
        "is_active": True,
        "category_tags": ["government", "federal", "construction"],
        "crawl_config": {
            "crawler_class": "canadian_federal",
            "max_pages": 5,
            "rate_limit_seconds": 3,
        },
    },
    {
        "name": "Municipal Procurement — CA & US",
        "source_type": "municipal",
        "base_url": "https://municipal-procurement.example.com",
        "country": "CA",
        "region": None,
        "frequency": "daily",
        "is_active": True,
        "category_tags": ["municipal", "construction", "renovation"],
        "crawl_config": {
            "crawler_class": "municipal",
            "max_pages": 10,
            "rate_limit_seconds": 3,
        },
    },
    {
        "name": "School Board Tenders — Ontario",
        "source_type": "school_board",
        "base_url": "https://schoolboard-procurement.example.com",
        "country": "CA",
        "region": "ON",
        "frequency": "weekly",
        "is_active": True,
        "category_tags": ["education", "school", "renovation"],
        "crawl_config": {
            "crawler_class": "school_board",
            "max_pages": 3,
            "rate_limit_seconds": 5,
        },
    },
    {
        "name": "Housing Authority Bids — CA & US",
        "source_type": "housing_authority",
        "base_url": "https://housing-bids.example.com",
        "country": "CA",
        "region": None,
        "frequency": "weekly",
        "is_active": True,
        "category_tags": ["housing", "residential", "social housing"],
        "crawl_config": {
            "crawler_class": "housing_authority",
            "max_pages": 5,
            "rate_limit_seconds": 5,
        },
    },
]


def setup_sources() -> None:
    """Register the demo sources in the database."""
    with get_db() as session:
        for src in DEMO_SOURCES:
            existing = session.execute(
                text("SELECT id FROM sources WHERE name = :name"),
                {"name": src["name"]},
            ).fetchone()

            if existing:
                logger.info("Source already exists: %s", src["name"])
                session.execute(
                    text("UPDATE sources SET crawl_config = :cfg, is_active = true WHERE id = :id"),
                    {"cfg": json.dumps(src["crawl_config"]), "id": str(existing.id)},
                )
                continue

            session.execute(
                text("""
                    INSERT INTO sources (name, source_type, base_url, country, region,
                                         frequency, is_active, category_tags, crawl_config,
                                         updated_at)
                    VALUES (:name, :source_type, :base_url, :country, :region,
                            :frequency, :is_active, :category_tags, :crawl_config,
                            NOW())
                """),
                {
                    "name": src["name"],
                    "source_type": src["source_type"],
                    "base_url": src["base_url"],
                    "country": src["country"],
                    "region": src["region"],
                    "frequency": src["frequency"],
                    "is_active": src["is_active"],
                    "category_tags": src["category_tags"],
                    "crawl_config": json.dumps(src["crawl_config"]),
                },
            )
            logger.info("Created source: %s", src["name"])

    logger.info("Source setup complete — %d sources registered", len(DEMO_SOURCES))


def get_source_configs(source_filter: str | None = None) -> list[SourceConfig]:
    """Load active source configs from the database."""
    with get_db() as session:
        if source_filter:
            rows = session.execute(
                text("""
                    SELECT id, name, source_type, base_url, country, region,
                           crawl_config, frequency, is_active, category_tags
                    FROM sources
                    WHERE is_active = true
                      AND (crawl_config->>'crawler_class' = :filter OR name ILIKE :name_filter)
                    ORDER BY name
                """),
                {"filter": source_filter, "name_filter": f"%{source_filter}%"},
            ).fetchall()
        else:
            rows = session.execute(
                text("""
                    SELECT id, name, source_type, base_url, country, region,
                           crawl_config, frequency, is_active, category_tags
                    FROM sources
                    WHERE is_active = true AND crawl_config->>'crawler_class' IS NOT NULL
                    ORDER BY name
                """),
            ).fetchall()

    configs = []
    for row in rows:
        crawl_config = row.crawl_config if isinstance(row.crawl_config, dict) else json.loads(row.crawl_config or "{}")
        configs.append(SourceConfig(
            id=str(row.id),
            name=row.name,
            source_type=SourceType(row.source_type),
            base_url=row.base_url,
            country=row.country,
            region=row.region,
            crawl_config=crawl_config,
            frequency=CrawlFrequency(row.frequency),
            is_active=row.is_active,
            category_tags=row.category_tags or [],
        ))

    return configs


def run_crawl(source_filter: str | None = None) -> None:
    """Execute the crawl pipeline for all active sources."""
    configs = get_source_configs(source_filter)

    if not configs:
        logger.error("No active sources found. Run with --setup-sources first.")
        sys.exit(1)

    logger.info("=" * 60)
    logger.info("LeadHarvest Crawl Pipeline")
    logger.info("Sources to crawl: %d", len(configs))
    logger.info("=" * 60)

    total_created = 0
    total_updated = 0
    total_skipped = 0
    total_found = 0

    for config in configs:
        logger.info("-" * 60)
        logger.info("CRAWLING: %s (%s)", config.name, config.country)
        logger.info("-" * 60)

        with get_db() as session:
            pipeline = CrawlPipeline(config, session)
            result = pipeline.run(triggered_by=TriggerType.MANUAL)

        logger.info(
            "Result: found=%d created=%d updated=%d skipped=%d errors=%d",
            result.opportunities_found,
            result.opportunities_created,
            result.opportunities_updated,
            result.opportunities_skipped,
            len(result.errors),
        )

        if result.errors:
            for err in result.errors:
                logger.warning("  Error: %s", err)

        total_found += result.opportunities_found
        total_created += result.opportunities_created
        total_updated += result.opportunities_updated
        total_skipped += result.opportunities_skipped

    logger.info("=" * 60)
    logger.info("PIPELINE COMPLETE")
    logger.info("  Total found:   %d", total_found)
    logger.info("  Total created: %d", total_created)
    logger.info("  Total updated: %d", total_updated)
    logger.info("  Total skipped: %d", total_skipped)
    logger.info("=" * 60)


def show_status() -> None:
    """Display current source status and recent crawl stats."""
    with get_db() as session:
        rows = session.execute(
            text("""
                SELECT s.name, s.country, s.is_active, s.last_crawled_at,
                       s.last_run_status,
                       (SELECT COUNT(*) FROM opportunities o WHERE o.source_id = s.id) AS opp_count
                FROM sources s
                ORDER BY s.name
            """),
        ).fetchall()

    print(f"\n{'Source':<45} {'Country':<8} {'Active':<8} {'Opps':<8} {'Last Run':<20} {'Status'}")
    print("-" * 110)
    for row in rows:
        last_crawl = row.last_crawled_at.strftime("%Y-%m-%d %H:%M") if row.last_crawled_at else "never"
        print(
            f"{row.name:<45} {row.country:<8} {'yes' if row.is_active else 'no':<8} "
            f"{row.opp_count:<8} {last_crawl:<20} {row.last_run_status or '-'}"
        )
    print()


def main() -> None:
    parser = argparse.ArgumentParser(description="LeadHarvest Crawl Pipeline")
    parser.add_argument("--source", type=str, help="Run a specific source (by crawler_class or name)")
    parser.add_argument("--setup-sources", action="store_true", help="Register demo sources in DB")
    parser.add_argument("--status", action="store_true", help="Show source status")
    args = parser.parse_args()

    logger.info("Database: %s", settings.DATABASE_URL[:40] + "...")

    if args.setup_sources:
        setup_sources()
    elif args.status:
        show_status()
    else:
        run_crawl(source_filter=args.source)


if __name__ == "__main__":
    main()
