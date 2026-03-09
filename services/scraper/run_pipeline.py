#!/usr/bin/env python3
"""CLI entry point for running the LeadHarvest crawl pipeline.

Usage:
    python run_pipeline.py                     # Run all active sources
    python run_pipeline.py --source vancouver  # Run a specific source
    python run_pipeline.py --status            # Show current source status
    python run_pipeline.py --register-source sources.json  # Bulk-register sources from JSON
    python run_pipeline.py --sync-sources                  # Sync data/sources.yaml → DB
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import yaml
from sqlalchemy import text

from src.core.config import settings
from src.core.database import get_db
from src.core.logging import get_logger
from src.crawlers.pipeline import CrawlPipeline
from src.models.opportunity import CrawlFrequency, SourceConfig, SourceType, TriggerType

logger = get_logger("run_pipeline")

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
SOURCES_YAML = PROJECT_ROOT / "data" / "sources.yaml"


def _upsert_source(session, src: dict) -> str:
    """Insert or update a single source row. Returns 'created' or 'updated'."""
    name = src.get("source_name") or src.get("name", "Unnamed")
    base_url = src.get("base_url", "")
    country = src.get("country", "CA")
    region = src.get("region")
    source_type = src.get("source_type", "bid_portal")
    frequency = src.get("crawl_frequency") or src.get("frequency", "daily")
    is_active = src.get("active", src.get("is_active", True))
    category_tags = src.get("category_tags", [])
    industry_fit_score = src.get("industry_fit_score", 50)
    source_priority = src.get("source_priority", "medium")
    listing_path = src.get("listing_path")
    notes = src.get("notes", "")
    crawl_config = src.get("crawl_config", {})
    if isinstance(crawl_config, str):
        crawl_config = json.loads(crawl_config)

    existing = session.execute(
        text("SELECT id FROM sources WHERE name = :name"),
        {"name": name},
    ).fetchone()

    if existing:
        session.execute(
            text("""UPDATE sources SET
                base_url = :base_url,
                source_type = :source_type,
                country = :country,
                region = :region,
                frequency = :frequency,
                is_active = :is_active,
                category_tags = :category_tags,
                industry_fit_score = :industry_fit_score,
                source_priority = :source_priority,
                listing_path = :listing_path,
                notes = :notes,
                crawl_config = :crawl_config,
                updated_at = NOW()
            WHERE id = :id"""),
            {
                "id": str(existing.id),
                "base_url": base_url,
                "source_type": source_type,
                "country": country,
                "region": region,
                "frequency": frequency,
                "is_active": is_active,
                "category_tags": category_tags,
                "industry_fit_score": industry_fit_score,
                "source_priority": source_priority,
                "listing_path": listing_path,
                "notes": notes[:500] if notes else None,
                "crawl_config": json.dumps(crawl_config),
            },
        )
        return "updated"

    session.execute(
        text("""
            INSERT INTO sources (name, source_type, base_url, country, region,
                                 frequency, is_active, category_tags,
                                 industry_fit_score, source_priority, listing_path,
                                 notes, crawl_config, updated_at)
            VALUES (:name, :source_type, :base_url, :country, :region,
                    :frequency, :is_active, :category_tags,
                    :industry_fit_score, :source_priority, :listing_path,
                    :notes, :crawl_config, NOW())
        """),
        {
            "name": name,
            "source_type": source_type,
            "base_url": base_url,
            "country": country,
            "region": region,
            "frequency": frequency,
            "is_active": is_active,
            "category_tags": category_tags,
            "industry_fit_score": industry_fit_score,
            "source_priority": source_priority,
            "listing_path": listing_path,
            "notes": notes[:500] if notes else None,
            "crawl_config": json.dumps(crawl_config),
        },
    )
    return "created"


def register_sources(filepath: str) -> None:
    """Register sources from a JSON file into the database."""
    path = Path(filepath)
    if not path.exists():
        logger.error("File not found: %s", filepath)
        sys.exit(1)

    sources = json.loads(path.read_text())
    if not isinstance(sources, list):
        sources = [sources]

    created = updated = 0
    with get_db() as session:
        for src in sources:
            action = _upsert_source(session, src)
            if action == "created":
                created += 1
            else:
                updated += 1
            logger.info("%s source: %s", action.capitalize(), src.get("name", "?"))

    logger.info("JSON registration complete — %d created, %d updated", created, updated)


def sync_sources_yaml(yaml_path: str | None = None) -> None:
    """Read data/sources.yaml and upsert every entry into the DB.

    This is the primary mechanism for getting the 300+ source registry
    into the database so crawlers can operate on them.
    """
    path = Path(yaml_path) if yaml_path else SOURCES_YAML
    if not path.exists():
        logger.error("YAML file not found: %s", path)
        sys.exit(1)

    data = yaml.safe_load(path.read_text())
    sources = data.get("sources", []) if isinstance(data, dict) else data
    if not sources:
        logger.error("No sources found in %s", path)
        sys.exit(1)

    logger.info("Syncing %d sources from %s", len(sources), path)
    created = updated = skipped = 0

    with get_db() as session:
        for src in sources:
            if not src.get("base_url"):
                skipped += 1
                continue
            try:
                action = _upsert_source(session, src)
                if action == "created":
                    created += 1
                else:
                    updated += 1
            except Exception:
                logger.exception("Failed to sync source: %s", src.get("source_name", "?"))
                skipped += 1

    logger.info(
        "YAML sync complete — %d created, %d updated, %d skipped (total %d)",
        created, updated, skipped, len(sources),
    )


def get_source_configs(source_filter: str | None = None) -> list[SourceConfig]:
    """Load active source configs from the database."""
    _COLUMNS = """id, name, source_type, base_url, country, region,
                  crawl_config, frequency, is_active, category_tags,
                  industry_fit_score, source_priority, listing_path"""
    with get_db() as session:
        if source_filter:
            rows = session.execute(
                text(f"""
                    SELECT {_COLUMNS}
                    FROM sources
                    WHERE is_active = true
                      AND (crawl_config->>'crawler_class' = :filter OR name ILIKE :name_filter)
                    ORDER BY name
                """),
                {"filter": source_filter, "name_filter": f"%{source_filter}%"},
            ).fetchall()
        else:
            rows = session.execute(
                text(f"""
                    SELECT {_COLUMNS}
                    FROM sources
                    WHERE is_active = true
                      AND crawl_config->>'crawler_class' IS NOT NULL
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
            industry_fit_score=getattr(row, "industry_fit_score", 50) or 50,
            source_priority=getattr(row, "source_priority", "medium") or "medium",
            listing_path=getattr(row, "listing_path", None),
        ))

    return configs


def run_crawl(source_filter: str | None = None) -> None:
    """Execute the crawl pipeline for all active sources."""
    configs = get_source_configs(source_filter)

    if not configs:
        logger.error("No active sources found. Register sources with --register-source first.")
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
    parser.add_argument("--register-source", type=str, metavar="FILE",
                        help="Register sources from a JSON file")
    parser.add_argument("--sync-sources", nargs="?", const=str(SOURCES_YAML), metavar="YAML",
                        help="Sync sources from YAML to DB (default: data/sources.yaml)")
    parser.add_argument("--status", action="store_true", help="Show source status")
    args = parser.parse_args()

    logger.info("Database: %s", settings.DATABASE_URL[:40] + "...")

    if args.sync_sources:
        sync_sources_yaml(args.sync_sources)
    elif args.register_source:
        register_sources(args.register_source)
    elif args.status:
        show_status()
    else:
        run_crawl(source_filter=args.source)


if __name__ == "__main__":
    main()
