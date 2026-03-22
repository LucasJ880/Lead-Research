"""Canonical source definitions for BidToGo.

Run standalone to upsert sources into the database:
    python -m src.seeds.sources

Each source is upserted by name — safe to run repeatedly.
"""

from __future__ import annotations

import json
import sys
from datetime import datetime, timezone

from sqlalchemy import text

from src.core.database import get_db_session
from src.core.logging import get_logger

logger = get_logger(__name__)

SOURCES = [
    {
        "name": "MERX Canadian Public Tenders",
        "source_type": "aggregator",
        "base_url": "https://www.merx.com",
        "country": "CA",
        "region": None,
        "listing_path": "/public/solicitations/open",
        "crawl_config": {
            "crawler_class": "merx",
            "max_pages_per_search": 5,
            "fetch_detail": True,
            "include_broad_keywords": True,
        },
        "access_mode": "local_connector",
        "frequency": "daily",
        "is_active": True,
        "source_priority": "critical",
        "industry_fit_score": 85,
        "health_status": "degraded",
        "notes": "Canada largest e-tendering platform. Runs via local agent (datacenter IPs blocked).",
    },
    {
        "name": "SAM.gov",
        "source_type": "bid_portal",
        "base_url": "https://sam.gov",
        "country": "US",
        "region": None,
        "listing_path": "/search",
        "crawl_config": {
            "crawler_class": "sam_gov",
            "max_pages": 10,
            "per_page": 100,
            "days_back": 30,
            "pre_filter_keywords": False,
        },
        "access_mode": "api",
        "frequency": "daily",
        "is_active": True,
        "source_priority": "high",
        "industry_fit_score": 60,
        "health_status": "untested",
        "notes": "US federal procurement API. NAICS-targeted + keyword searches.",
    },
    {
        "name": "Nova Scotia Procurement Portal",
        "source_type": "bid_portal",
        "base_url": "https://procurement-portal.novascotia.ca",
        "country": "CA",
        "region": "NS",
        "listing_path": "/tenders",
        "crawl_config": {
            "crawler_class": "novascotia",
            "max_pages": 10,
            "page_size": 50,
            "fetch_detail": True,
            "rate_limit_seconds": 3,
        },
        "access_mode": "http_scrape",
        "frequency": "daily",
        "is_active": True,
        "source_priority": "high",
        "industry_fit_score": 55,
        "health_status": "untested",
        "notes": "NS provincial procurement portal. 28K+ tenders. Uses cloudscraper for F5 bot protection.",
    },
    {
        "name": "CanadaBuys",
        "source_type": "bid_portal",
        "base_url": "https://canadabuys.canada.ca",
        "country": "CA",
        "region": None,
        "listing_path": "/en/tender-opportunities",
        "crawl_config": {
            "crawler_class": "canadabuys",
            "csv_url": "https://canadabuys.canada.ca/opendata/pub/openTenderNotice-ouvertAvisAppelOffres.csv",
        },
        "access_mode": "api",
        "frequency": "daily",
        "is_active": True,
        "source_priority": "critical",
        "industry_fit_score": 75,
        "health_status": "untested",
        "notes": "Canadian federal procurement via Open Data CSV. Updated daily 7-8:30am EST. All open tenders.",
    },
    {
        "name": "Toronto Bids Portal",
        "source_type": "bid_portal",
        "base_url": "https://www.toronto.ca",
        "country": "CA",
        "region": "ON",
        "listing_path": "/business-economy/doing-business-with-the-city/searching-bidding-on-city-contracts/toronto-bids-portal/",
        "crawl_config": {},
        "access_mode": "authenticated_browser",
        "frequency": "daily",
        "is_active": False,
        "source_priority": "high",
        "industry_fit_score": 65,
        "health_status": "unsupported",
        "notes": "Uses SAP Ariba embedded portal. Requires browser automation (Playwright). Deactivated until support is added.",
    },
    {
        "name": "BidNet Direct",
        "source_type": "aggregator",
        "base_url": "https://www.bidnetdirect.com",
        "country": "US",
        "region": None,
        "listing_path": "/",
        "crawl_config": {},
        "access_mode": "authenticated_browser",
        "frequency": "daily",
        "is_active": False,
        "source_priority": "medium",
        "industry_fit_score": 50,
        "health_status": "unsupported",
        "notes": "Requires browser automation. Deactivated until Playwright support is added.",
    },
]


def seed_sources() -> None:
    """Upsert all canonical sources into the database."""
    session = get_db_session()
    try:
        for src in SOURCES:
            existing = session.execute(
                text("SELECT id FROM sources WHERE name = :name"),
                {"name": src["name"]},
            ).fetchone()

            if existing:
                session.execute(
                    text("""
                        UPDATE sources SET
                            base_url = :base_url,
                            crawl_config = :crawl_config,
                            access_mode = :access_mode,
                            frequency = :frequency,
                            is_active = :is_active,
                            source_priority = :source_priority,
                            industry_fit_score = :industry_fit_score,
                            health_status = :health_status,
                            notes = :notes,
                            listing_path = :listing_path,
                            updated_at = :now
                        WHERE name = :name
                    """),
                    {
                        "name": src["name"],
                        "base_url": src["base_url"],
                        "crawl_config": json.dumps(src["crawl_config"]),
                        "access_mode": src["access_mode"],
                        "frequency": src["frequency"],
                        "is_active": src["is_active"],
                        "source_priority": src["source_priority"],
                        "industry_fit_score": src["industry_fit_score"],
                        "health_status": src["health_status"],
                        "notes": src["notes"],
                        "listing_path": src.get("listing_path"),
                        "now": datetime.now(timezone.utc),
                    },
                )
                logger.info("Updated source: %s", src["name"])
            else:
                session.execute(
                    text("""
                        INSERT INTO sources (
                            name, source_type, base_url, country, region,
                            listing_path, crawl_config, access_mode, frequency,
                            is_active, source_priority, industry_fit_score,
                            health_status, notes, updated_at
                        ) VALUES (
                            :name, :source_type, :base_url, :country, :region,
                            :listing_path, :crawl_config, :access_mode, :frequency,
                            :is_active, :source_priority, :industry_fit_score,
                            :health_status, :notes, :now
                        )
                    """),
                    {
                        "name": src["name"],
                        "source_type": src["source_type"],
                        "base_url": src["base_url"],
                        "country": src["country"],
                        "region": src["region"],
                        "listing_path": src.get("listing_path"),
                        "crawl_config": json.dumps(src["crawl_config"]),
                        "access_mode": src["access_mode"],
                        "frequency": src["frequency"],
                        "is_active": src["is_active"],
                        "source_priority": src["source_priority"],
                        "industry_fit_score": src["industry_fit_score"],
                        "health_status": src["health_status"],
                        "notes": src["notes"],
                        "now": datetime.now(timezone.utc),
                    },
                )
                logger.info("Inserted source: %s", src["name"])

        session.commit()
        logger.info("Source seeding complete: %d sources processed", len(SOURCES))
    except Exception:
        session.rollback()
        logger.exception("Source seeding failed")
        raise
    finally:
        session.close()


if __name__ == "__main__":
    seed_sources()
    sys.exit(0)
