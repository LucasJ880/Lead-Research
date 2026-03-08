"""End-to-end crawl pipeline: fetch → parse → normalize → score → dedup → store."""

from __future__ import annotations

import json
from datetime import date, datetime, timezone
from decimal import Decimal


class _SafeEncoder(json.JSONEncoder):
    def default(self, o):
        if isinstance(o, (datetime, date)):
            return o.isoformat()
        if isinstance(o, Decimal):
            return float(o)
        return super().default(o)


def _safe_json_dumps(obj):
    if obj is None:
        return None
    return json.dumps(obj, cls=_SafeEncoder)

from sqlalchemy import text
from sqlalchemy.orm import Session

from src.core.config import settings
from src.core.logging import get_logger
from src.crawlers.generic import GenericCrawler
from src.models.opportunity import (
    CrawlResult,
    OpportunityCreate,
    RunStatus,
    SourceConfig,
    TriggerType,
)
from src.utils.dedup import check_duplicate, check_source_duplicate, generate_fingerprint
from src.utils.normalizer import (
    clean_html,
    normalize_currency,
    normalize_date,
    normalize_location,
    normalize_status,
)
from src.utils.scorer import score_opportunity

logger = get_logger(__name__)


class CrawlPipeline:
    """Orchestrates fetching, parsing, normalizing, scoring, deduplication,
    and storage for a single source crawl run.
    """

    def __init__(self, source_config: SourceConfig, db_session: Session) -> None:
        self._source_config = source_config
        self._session = db_session
        self._result = CrawlResult(source_id=source_config.id)

    def run(self, triggered_by: TriggerType = TriggerType.SCHEDULE) -> CrawlResult:
        """Execute the full pipeline and return a summary.

        Args:
            triggered_by: What initiated this crawl (schedule, manual, retry).

        Returns:
            CrawlResult with aggregate statistics.
        """
        source_run_id = self._create_source_run(triggered_by)

        try:
            # 1. Crawl
            raw_opportunities = self._crawl()
            self._result.opportunities_found = len(raw_opportunities)

            # 2. Normalize + score + dedup + store
            for opp in raw_opportunities:
                try:
                    opp = self._normalize(opp)
                    opp = self._score(opp)
                    opp.source_run_id = source_run_id
                    self._dedup_and_store(opp)
                except Exception as exc:
                    self._result.errors.append(f"Processing error: {exc}")
                    logger.exception("Error processing opportunity: %s", opp.title)

            self._finalize_source_run(source_run_id, RunStatus.COMPLETED)

        except Exception as exc:
            self._result.errors.append(f"Pipeline error: {exc}")
            logger.exception("Pipeline failed for source %s", self._source_config.id)
            self._finalize_source_run(source_run_id, RunStatus.FAILED, str(exc))

        return self._result

    # ─── Pipeline Steps ─────────────────────────────────────

    def _crawl(self) -> list[OpportunityCreate]:
        """Instantiate the appropriate crawler and fetch opportunities."""
        from src.crawlers.procurement_sources import CRAWLER_REGISTRY

        crawler_key = self._source_config.crawl_config.get("crawler_class")
        if crawler_key and crawler_key in CRAWLER_REGISTRY:
            crawler_cls = CRAWLER_REGISTRY[crawler_key]
            crawler = crawler_cls(self._source_config, self._session)
        else:
            crawler = GenericCrawler(self._source_config, self._session)

        opportunities = crawler.crawl()
        self._result.pages_crawled = self._source_config.crawl_config.get(
            "max_pages", settings.DEFAULT_MAX_PAGES_PER_SOURCE
        )
        return opportunities

    def _normalize(self, opp: OpportunityCreate) -> OpportunityCreate:
        """Apply normalization to dates, location, status, and currency."""
        if opp.closing_date is None and opp.raw_data and opp.raw_data.get("closing_date"):
            parsed = normalize_date(opp.raw_data["closing_date"])
            if parsed:
                opp.closing_date = datetime(
                    parsed.year, parsed.month, parsed.day, tzinfo=timezone.utc
                )

        if opp.posted_date is None and opp.raw_data and opp.raw_data.get("posted_date"):
            opp.posted_date = normalize_date(opp.raw_data["posted_date"])

        if opp.location_raw and not opp.region:
            loc = normalize_location(opp.location_raw, opp.country or self._source_config.country)
            opp.country = loc["country"] or opp.country
            opp.region = loc["region"] or opp.region
            opp.city = loc["city"] or opp.city

        if opp.raw_data and opp.raw_data.get("status"):
            opp.status = normalize_status(opp.raw_data["status"])  # type: ignore[assignment]

        if opp.estimated_value is None and opp.raw_data and opp.raw_data.get("estimated_value"):
            amount, currency = normalize_currency(opp.raw_data["estimated_value"])
            if amount is not None:
                opp.estimated_value = amount
                opp.currency = currency

        if opp.description_full:
            opp.description_full = clean_html(opp.description_full)

        closing_str = str(opp.closing_date) if opp.closing_date else ""
        opp.fingerprint = generate_fingerprint(
            opp.title,
            opp.organization_name or "",
            closing_str,
            opp.source_url,
        )

        return opp

    def _score(self, opp: OpportunityCreate) -> OpportunityCreate:
        """Compute the relevance score and attach matched keywords."""
        description = opp.description_full or opp.description_summary or ""
        score, breakdown = score_opportunity(
            title=opp.title,
            description=description,
            org_type=None,
            project_type=opp.project_type,
        )
        opp.relevance_score = score
        opp.relevance_breakdown = breakdown
        opp.keywords_matched = (
            breakdown.get("primary_matches", [])
            + breakdown.get("secondary_matches", [])
            + breakdown.get("project_matches", [])
        )
        return opp

    def _dedup_and_store(self, opp: OpportunityCreate) -> None:
        """Check for duplicates and insert or update the opportunity."""
        # Check by source + external ID first
        if opp.external_id:
            existing_id = check_source_duplicate(
                self._session, opp.source_id, opp.external_id
            )
            if existing_id:
                self._update_opportunity(existing_id, opp)
                return

        # Check by fingerprint
        existing_id = check_duplicate(self._session, opp.fingerprint)
        if existing_id:
            self._result.opportunities_skipped += 1
            logger.debug("Skipping duplicate: %s", opp.title)
            return

        self._insert_opportunity(opp)

    # ─── Database Operations ────────────────────────────────

    def _insert_opportunity(self, opp: OpportunityCreate) -> None:
        """Insert a new opportunity row."""
        try:
            self._session.execute(
                text("""
                    INSERT INTO opportunities (
                        source_id, source_run_id, external_id,
                        title, description_summary, description_full,
                        status, country, region, city, location_raw,
                        posted_date, closing_date, project_type, category,
                        solicitation_number, estimated_value, currency,
                        contact_name, contact_email, contact_phone,
                        source_url, has_documents,
                        mandatory_site_visit, pre_bid_meeting, addenda_count,
                        keywords_matched, relevance_score, relevance_breakdown,
                        raw_data, fingerprint, updated_at
                    ) VALUES (
                        :source_id, :source_run_id, :external_id,
                        :title, :description_summary, :description_full,
                        :status, :country, :region, :city, :location_raw,
                        :posted_date, :closing_date, :project_type, :category,
                        :solicitation_number, :estimated_value, :currency,
                        :contact_name, :contact_email, :contact_phone,
                        :source_url, :has_documents,
                        :mandatory_site_visit, :pre_bid_meeting, :addenda_count,
                        :keywords_matched, :relevance_score, :relevance_breakdown,
                        :raw_data, :fingerprint, NOW()
                    )
                """),
                {
                    "source_id": opp.source_id,
                    "source_run_id": opp.source_run_id,
                    "external_id": opp.external_id,
                    "title": opp.title,
                    "description_summary": opp.description_summary,
                    "description_full": opp.description_full,
                    "status": opp.status.value if opp.status else "unknown",
                    "country": opp.country,
                    "region": opp.region,
                    "city": opp.city,
                    "location_raw": opp.location_raw,
                    "posted_date": opp.posted_date,
                    "closing_date": opp.closing_date,
                    "project_type": opp.project_type,
                    "category": opp.category,
                    "solicitation_number": opp.solicitation_number,
                    "estimated_value": float(opp.estimated_value) if opp.estimated_value else None,
                    "currency": opp.currency,
                    "contact_name": opp.contact_name,
                    "contact_email": opp.contact_email,
                    "contact_phone": opp.contact_phone,
                    "source_url": opp.source_url,
                    "has_documents": opp.has_documents,
                    "mandatory_site_visit": opp.mandatory_site_visit,
                    "pre_bid_meeting": opp.pre_bid_meeting,
                    "addenda_count": opp.addenda_count,
                    "keywords_matched": opp.keywords_matched,
                    "relevance_score": opp.relevance_score,
                    "relevance_breakdown": _safe_json_dumps(opp.relevance_breakdown),
                    "raw_data": _safe_json_dumps(opp.raw_data),
                    "fingerprint": opp.fingerprint,
                },
            )
            self._session.flush()
            self._result.opportunities_created += 1
            logger.debug("Inserted opportunity: %s", opp.title)

        except Exception:
            logger.exception("Failed to insert opportunity: %s", opp.title)
            self._result.errors.append(f"Insert failed: {opp.title}")

    def _update_opportunity(self, opportunity_id: str, opp: OpportunityCreate) -> None:
        """Update an existing opportunity with fresh data."""
        try:
            self._session.execute(
                text("""
                    UPDATE opportunities SET
                        source_run_id = :source_run_id,
                        title = :title,
                        description_summary = COALESCE(:description_summary, description_summary),
                        description_full = COALESCE(:description_full, description_full),
                        status = :status,
                        closing_date = COALESCE(:closing_date, closing_date),
                        estimated_value = COALESCE(:estimated_value, estimated_value),
                        keywords_matched = :keywords_matched,
                        relevance_score = :relevance_score,
                        relevance_breakdown = :relevance_breakdown,
                        updated_at = NOW()
                    WHERE id = :id
                """),
                {
                    "id": opportunity_id,
                    "source_run_id": opp.source_run_id,
                    "title": opp.title,
                    "description_summary": opp.description_summary,
                    "description_full": opp.description_full,
                    "status": opp.status.value if opp.status else "unknown",
                    "closing_date": opp.closing_date,
                    "estimated_value": float(opp.estimated_value) if opp.estimated_value else None,
                    "keywords_matched": opp.keywords_matched,
                    "relevance_score": opp.relevance_score,
                    "relevance_breakdown": _safe_json_dumps(opp.relevance_breakdown),
                },
            )
            self._session.flush()
            self._result.opportunities_updated += 1
            logger.debug("Updated opportunity %s: %s", opportunity_id, opp.title)

        except Exception:
            logger.exception("Failed to update opportunity %s", opportunity_id)
            self._result.errors.append(f"Update failed: {opp.title}")

    # ─── Source Run Management ──────────────────────────────

    def _create_source_run(self, triggered_by: TriggerType) -> str:
        """Insert a new source_run record and return its ID."""
        row = self._session.execute(
            text("""
                INSERT INTO source_runs (source_id, status, started_at, triggered_by)
                VALUES (:source_id, :status, :started_at, :triggered_by)
                RETURNING id
            """),
            {
                "source_id": self._source_config.id,
                "status": RunStatus.RUNNING.value,
                "started_at": datetime.now(timezone.utc),
                "triggered_by": triggered_by.value,
            },
        ).fetchone()
        self._session.flush()
        run_id = str(row.id)  # type: ignore[union-attr]
        logger.info("Created source_run %s for source %s", run_id, self._source_config.id)
        return run_id

    def _finalize_source_run(
        self,
        run_id: str,
        status: RunStatus,
        error_message: str | None = None,
    ) -> None:
        """Update the source_run record with final stats."""
        try:
            self._session.execute(
                text("""
                    UPDATE source_runs SET
                        status = :status,
                        completed_at = :completed_at,
                        duration_ms = EXTRACT(EPOCH FROM (:completed_at - started_at))::int * 1000,
                        pages_crawled = :pages_crawled,
                        opportunities_found = :found,
                        opportunities_created = :created,
                        opportunities_updated = :updated,
                        opportunities_skipped = :skipped,
                        error_message = :error_message,
                        error_details = :error_details
                    WHERE id = :id
                """),
                {
                    "id": run_id,
                    "status": status.value,
                    "completed_at": datetime.now(timezone.utc),
                    "pages_crawled": self._result.pages_crawled,
                    "found": self._result.opportunities_found,
                    "created": self._result.opportunities_created,
                    "updated": self._result.opportunities_updated,
                    "skipped": self._result.opportunities_skipped,
                    "error_message": error_message,
                    "error_details": json.dumps(self._result.errors) if self._result.errors else None,
                },
            )

            self._session.execute(
                text("""
                    UPDATE sources SET
                        last_crawled_at = :now,
                        last_run_status = :status
                    WHERE id = :source_id
                """),
                {
                    "now": datetime.now(timezone.utc),
                    "status": status.value,
                    "source_id": self._source_config.id,
                },
            )

            self._session.flush()
            logger.info(
                "Finalized source_run %s: status=%s found=%d created=%d updated=%d skipped=%d",
                run_id,
                status.value,
                self._result.opportunities_found,
                self._result.opportunities_created,
                self._result.opportunities_updated,
                self._result.opportunities_skipped,
            )

        except Exception:
            logger.exception("Failed to finalize source_run %s", run_id)
