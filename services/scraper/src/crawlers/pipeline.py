"""End-to-end crawl pipeline: fetch → parse → normalize → score → dedup → store."""

from __future__ import annotations

import json
import time as _time
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
from src.utils.translator import translate_to_zh

logger = get_logger(__name__)


class CrawlPipeline:
    """Orchestrates fetching, parsing, normalizing, scoring, deduplication,
    and storage for a single source crawl run.
    """

    def __init__(self, source_config: SourceConfig, db_session: Session) -> None:
        self._source_config = source_config
        self._session = db_session
        self._result = CrawlResult(source_id=source_config.id)
        self._crawler_diagnostics: dict = {}

    def run(self, triggered_by: TriggerType = TriggerType.SCHEDULE) -> CrawlResult:
        """Execute the full pipeline and return a summary.

        Args:
            triggered_by: What initiated this crawl (schedule, manual, retry).

        Returns:
            CrawlResult with aggregate statistics.
        """
        pipeline_start = _time.monotonic()
        access_mode = getattr(self._source_config, "access_mode", "http")
        logger.info(
            "Pipeline starting for source '%s' [access_mode=%s, triggered_by=%s]",
            self._source_config.name, access_mode, triggered_by.value,
        )

        source_run_id = self._create_source_run(triggered_by)

        try:
            # 1. Crawl
            t0 = _time.monotonic()
            raw_opportunities = self._crawl()
            crawl_ms = int((_time.monotonic() - t0) * 1000)
            self._result.opportunities_found = len(raw_opportunities)
            logger.info(
                "  Crawl stage: %d opportunities fetched in %dms",
                len(raw_opportunities), crawl_ms,
            )

            # 2. Normalize + score + dedup + store
            t0 = _time.monotonic()
            for opp in raw_opportunities:
                try:
                    opp = self._normalize(opp)
                    opp = self._score(opp)
                    opp.source_run_id = source_run_id
                    zh_fields = self._translate_if_relevant(opp)
                    self._dedup_and_store(opp, zh_fields=zh_fields)
                except Exception as exc:
                    self._result.errors.append(f"Processing error: {exc}")
                    logger.exception("Error processing opportunity: %s", opp.title)
            process_ms = int((_time.monotonic() - t0) * 1000)

            total_ms = int((_time.monotonic() - pipeline_start) * 1000)
            logger.info(
                "  Process stage: normalize+score+store in %dms | Total: %dms | "
                "created=%d updated=%d skipped=%d errors=%d",
                process_ms, total_ms,
                self._result.opportunities_created,
                self._result.opportunities_updated,
                self._result.opportunities_skipped,
                len(self._result.errors),
            )

            self._finalize_source_run(
                source_run_id, RunStatus.COMPLETED,
                metadata={"crawl_ms": crawl_ms, "process_ms": process_ms, "total_ms": total_ms,
                          "access_mode": str(access_mode), **self._crawler_diagnostics},
            )

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
            logger.info(
                "  Crawler selection: '%s' → %s (from crawl_config)",
                crawler_key, crawler_cls.__name__,
            )
            crawler = crawler_cls(self._source_config, self._session)
        else:
            logger.warning(
                "  Crawler selection: no crawler_class in crawl_config (got %r) → GenericCrawler fallback",
                crawler_key,
            )
            crawler = GenericCrawler(self._source_config, self._session)

        opportunities = crawler.crawl()
        diagnostics_fn = getattr(crawler, "diagnostics", None)
        if callable(diagnostics_fn):
            try:
                self._crawler_diagnostics = diagnostics_fn() or {}
            except Exception:
                logger.exception("Failed to read crawler diagnostics for %s", self._source_config.name)
                self._crawler_diagnostics = {}
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
        """Compute the relevance score, bucket, tags, and keyword arrays."""
        description = opp.description_full or opp.description_summary or ""
        source_fit = getattr(self._source_config, "industry_fit_score", None)
        score, breakdown = score_opportunity(
            title=opp.title,
            description=description,
            org_type=None,
            project_type=opp.project_type,
            category=opp.category,
            source_fit_score=source_fit,
        )
        opp.relevance_score = score
        opp.relevance_breakdown = breakdown
        opp.relevance_bucket = breakdown.get("relevance_bucket", "irrelevant")
        opp.keywords_matched = (
            breakdown.get("primary_matches", [])
            + breakdown.get("secondary_matches", [])
            + breakdown.get("contextual_matches", [])
        )
        opp.negative_keywords = breakdown.get("negative_matches", [])
        opp.industry_tags = breakdown.get("industry_tags", [])
        return opp

    def _validate(self, opp: OpportunityCreate) -> bool:
        """Reject records with missing or invalid required fields."""
        if not opp.title or not opp.title.strip():
            logger.warning("Rejected opportunity: empty title")
            self._result.opportunities_skipped += 1
            return False
        if not opp.source_url or not opp.source_url.startswith("http"):
            logger.warning("Rejected opportunity: invalid source_url — %s", opp.source_url)
            self._result.opportunities_skipped += 1
            return False
        from src.models.opportunity import OpportunityStatus
        if opp.status in (OpportunityStatus.CLOSED, OpportunityStatus.AWARDED, OpportunityStatus.CANCELLED):
            logger.debug("Rejected non-open opportunity: %s (status=%s)", opp.title[:60], opp.status)
            self._result.opportunities_skipped += 1
            return False
        return True

    def _translate_if_relevant(self, opp: OpportunityCreate) -> dict | None:
        """Translate title/descriptions to Chinese if relevance >= 80."""
        if opp.relevance_score < 80:
            return None
        try:
            title_zh = translate_to_zh(opp.title) if opp.title else None
            summary_zh = translate_to_zh(opp.description_summary) if opp.description_summary else None
            full_zh = translate_to_zh(opp.description_full) if opp.description_full else None
            if title_zh or summary_zh or full_zh:
                return {"title_zh": title_zh, "summary_zh": summary_zh, "full_zh": full_zh}
        except Exception:
            logger.exception("Inline translation failed for: %s", opp.title)
        return None

    def _dedup_and_store(self, opp: OpportunityCreate, *, zh_fields: dict | None = None) -> None:
        """Check for duplicates and insert or update the opportunity."""
        if not self._validate(opp):
            return

        # Check by source + external ID first
        if opp.external_id:
            existing_id = check_source_duplicate(
                self._session, opp.source_id, opp.external_id
            )
            if existing_id:
                self._update_opportunity(existing_id, opp, zh_fields=zh_fields)
                return

        # Check by fingerprint
        existing_id = check_duplicate(self._session, opp.fingerprint)
        if existing_id:
            self._result.opportunities_skipped += 1
            logger.debug("Skipping duplicate: %s", opp.title)
            return

        self._insert_opportunity(opp, zh_fields=zh_fields)

    # ─── Database Operations ────────────────────────────────

    def _insert_opportunity(self, opp: OpportunityCreate, *, zh_fields: dict | None = None) -> None:
        """Insert a new opportunity row using a SAVEPOINT for isolation."""
        zh = zh_fields or {}
        try:
            self._session.execute(text("SAVEPOINT opp_insert"))
            self._session.execute(
                text("""
                    INSERT INTO opportunities (
                        source_id, source_run_id, external_id,
                        title, description_summary, description_full,
                        title_zh, description_summary_zh, description_full_zh, translated_at,
                        status, country, region, city, location_raw,
                        posted_date, closing_date, project_type, category,
                        solicitation_number, estimated_value, currency,
                        contact_name, contact_email, contact_phone,
                        source_url, has_documents,
                        mandatory_site_visit, pre_bid_meeting, addenda_count,
                        keywords_matched, negative_keywords, relevance_score,
                        relevance_bucket, relevance_breakdown, industry_tags,
                        set_aside, set_aside_restricted,
                        ingestion_mode, raw_data, fingerprint, updated_at
                    ) VALUES (
                        :source_id, :source_run_id, :external_id,
                        :title, :description_summary, :description_full,
                        :title_zh, :summary_zh, :full_zh, :translated_at,
                        :status, :country, :region, :city, :location_raw,
                        :posted_date, :closing_date, :project_type, :category,
                        :solicitation_number, :estimated_value, :currency,
                        :contact_name, :contact_email, :contact_phone,
                        :source_url, :has_documents,
                        :mandatory_site_visit, :pre_bid_meeting, :addenda_count,
                        :keywords_matched, :negative_keywords, :relevance_score,
                        :relevance_bucket, :relevance_breakdown, :industry_tags,
                        :set_aside, :set_aside_restricted,
                        'live', :raw_data, :fingerprint, NOW()
                    )
                """),
                {
                    "source_id": opp.source_id,
                    "source_run_id": opp.source_run_id,
                    "external_id": opp.external_id,
                    "title": opp.title,
                    "description_summary": opp.description_summary,
                    "description_full": opp.description_full,
                    "title_zh": zh.get("title_zh"),
                    "summary_zh": zh.get("summary_zh"),
                    "full_zh": zh.get("full_zh"),
                    "translated_at": datetime.now(timezone.utc) if zh else None,
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
                    "negative_keywords": opp.negative_keywords,
                    "relevance_score": opp.relevance_score,
                    "relevance_bucket": opp.relevance_bucket,
                    "relevance_breakdown": _safe_json_dumps(opp.relevance_breakdown),
                    "industry_tags": opp.industry_tags,
                    "set_aside": (opp.raw_data or {}).get("set_aside"),
                    "set_aside_restricted": bool((opp.raw_data or {}).get("set_aside_restricted", False)),
                    "raw_data": _safe_json_dumps(opp.raw_data),
                    "fingerprint": opp.fingerprint,
                },
            )
            self._session.flush()
            self._result.opportunities_created += 1
            logger.debug("Inserted opportunity: %s", opp.title)

            # Insert documents from raw_data.resource_links if present
            resource_links = (opp.raw_data or {}).get("resource_links", [])
            if resource_links and opp.external_id:
                self._insert_documents(opp.external_id, opp.source_id, resource_links)

        except Exception:
            logger.exception("Failed to insert opportunity: %s", opp.title)
            self._result.errors.append(f"Insert failed: {opp.title}")
            try:
                self._session.execute(text("ROLLBACK TO SAVEPOINT opp_insert"))
            except Exception:
                pass

    def _update_opportunity(self, opportunity_id: str, opp: OpportunityCreate, *, zh_fields: dict | None = None) -> None:
        """Update an existing opportunity with fresh data."""
        zh = zh_fields or {}
        try:
            self._session.execute(text("SAVEPOINT opp_update"))
            self._session.execute(
                text("""
                    UPDATE opportunities SET
                        source_run_id = :source_run_id,
                        title = :title,
                        description_summary = COALESCE(:description_summary, description_summary),
                        description_full = COALESCE(:description_full, description_full),
                        title_zh = COALESCE(:title_zh, title_zh),
                        description_summary_zh = COALESCE(:summary_zh, description_summary_zh),
                        description_full_zh = COALESCE(:full_zh, description_full_zh),
                        translated_at = COALESCE(:translated_at, translated_at),
                        status = :status,
                        closing_date = COALESCE(:closing_date, closing_date),
                        estimated_value = COALESCE(:estimated_value, estimated_value),
                        contact_name = COALESCE(:contact_name, contact_name),
                        contact_email = COALESCE(:contact_email, contact_email),
                        contact_phone = COALESCE(:contact_phone, contact_phone),
                        has_documents = COALESCE(:has_documents, has_documents),
                        keywords_matched = :keywords_matched,
                        negative_keywords = :negative_keywords,
                        relevance_score = :relevance_score,
                        relevance_bucket = :relevance_bucket,
                        relevance_breakdown = :relevance_breakdown,
                        industry_tags = :industry_tags,
                        set_aside = COALESCE(:set_aside, set_aside),
                        set_aside_restricted = :set_aside_restricted,
                        raw_data = COALESCE(:raw_data, raw_data),
                        updated_at = NOW()
                    WHERE id = :id
                """),
                {
                    "id": opportunity_id,
                    "source_run_id": opp.source_run_id,
                    "title": opp.title,
                    "description_summary": opp.description_summary,
                    "description_full": opp.description_full,
                    "title_zh": zh.get("title_zh"),
                    "summary_zh": zh.get("summary_zh"),
                    "full_zh": zh.get("full_zh"),
                    "translated_at": datetime.now(timezone.utc) if zh else None,
                    "status": opp.status.value if opp.status else "unknown",
                    "closing_date": opp.closing_date,
                    "estimated_value": float(opp.estimated_value) if opp.estimated_value else None,
                    "contact_name": opp.contact_name,
                    "contact_email": opp.contact_email,
                    "contact_phone": opp.contact_phone,
                    "has_documents": opp.has_documents if opp.has_documents else None,
                    "keywords_matched": opp.keywords_matched,
                    "negative_keywords": opp.negative_keywords,
                    "relevance_score": opp.relevance_score,
                    "relevance_bucket": opp.relevance_bucket,
                    "relevance_breakdown": _safe_json_dumps(opp.relevance_breakdown),
                    "industry_tags": opp.industry_tags,
                    "set_aside": (opp.raw_data or {}).get("set_aside"),
                    "set_aside_restricted": bool((opp.raw_data or {}).get("set_aside_restricted", False)),
                    "raw_data": _safe_json_dumps(opp.raw_data) if opp.raw_data else None,
                },
            )
            self._session.flush()
            self._result.opportunities_updated += 1
            logger.debug("Updated opportunity %s: %s", opportunity_id, opp.title)

            # Insert any new documents
            resource_links = (opp.raw_data or {}).get("resource_links", [])
            if resource_links and opp.external_id:
                self._insert_documents(opp.external_id, opp.source_id, resource_links)

        except Exception:
            logger.exception("Failed to update opportunity %s", opportunity_id)
            self._result.errors.append(f"Update failed: {opp.title}")
            try:
                self._session.execute(text("ROLLBACK TO SAVEPOINT opp_update"))
            except Exception:
                pass

    def _insert_documents(
        self, external_id: str, source_id: str, docs: list[dict],
    ) -> None:
        """Insert document rows for an opportunity, skipping duplicates."""
        # Look up the opportunity ID by external_id + source_id
        row = self._session.execute(
            text("SELECT id FROM opportunities WHERE external_id = :eid AND source_id = :sid LIMIT 1"),
            {"eid": external_id, "sid": source_id},
        ).fetchone()
        if not row:
            return
        opp_id = str(row.id)

        for doc in docs:
            url = doc.get("url", "")
            if not url:
                continue
            # Skip if already exists
            existing = self._session.execute(
                text("SELECT id FROM opportunity_documents WHERE opportunity_id = :oid AND url = :url LIMIT 1"),
                {"oid": opp_id, "url": url},
            ).fetchone()
            if existing:
                continue
            try:
                size_raw = doc.get("file_size_bytes")
                file_size = None
                if size_raw is not None:
                    try:
                        file_size = int(size_raw)
                    except (ValueError, TypeError):
                        pass
                self._session.execute(
                    text("""
                        INSERT INTO opportunity_documents (
                            opportunity_id, title, url, file_type, file_size_bytes, doc_category
                        ) VALUES (:oid, :title, :url, :ft, :fsz, :cat)
                    """),
                    {
                        "oid": opp_id,
                        "title": doc.get("title", "")[:250],
                        "url": url,
                        "ft": doc.get("file_type", "")[:50],
                        "fsz": file_size,
                        "cat": "source_attachment",
                    },
                )
            except Exception as exc:
                logger.debug("Failed to insert doc for %s: %s", opp_id, exc)

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
        metadata: dict | None = None,
    ) -> None:
        """Update the source_run record with final stats."""
        try:
            error_details_payload: list = list(self._result.errors) if self._result.errors else []
            if metadata:
                error_details_payload.insert(0, {"_pipeline_metadata": metadata})

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
                        error_details = :error_details,
                        metadata = COALESCE(CAST(:metadata AS jsonb), metadata)
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
                    "error_details": json.dumps(error_details_payload) if error_details_payload else None,
                    "metadata": json.dumps(metadata) if metadata else None,
                },
            )

            self._session.execute(
                text("""
                    UPDATE sources SET
                        last_crawled_at = :now,
                        last_run_status = :status,
                        health_status = (
                            SELECT CASE
                                WHEN :current_status = 'completed' AND :found > 0 THEN 'healthy'::"SourceHealthStatus"
                                WHEN :current_status = 'completed' AND :found = 0 THEN 'degraded'::"SourceHealthStatus"
                                WHEN :current_status = 'failed' AND fails::float / GREATEST(cnt, 1) > 0.8 THEN 'failing'::"SourceHealthStatus"
                                WHEN :current_status = 'failed' AND fails::float / GREATEST(cnt, 1) > 0.3 THEN 'degraded'::"SourceHealthStatus"
                                WHEN cnt = 0 THEN 'untested'::"SourceHealthStatus"
                                WHEN :current_status = 'completed' THEN 'healthy'::"SourceHealthStatus"
                                ELSE 'degraded'::"SourceHealthStatus"
                            END
                            FROM (
                                SELECT
                                    COUNT(*)::int AS cnt,
                                    COUNT(*) FILTER (WHERE sr.status = 'failed')::int AS fails
                                FROM source_runs sr
                                WHERE sr.source_id = :source_id
                            ) stats
                        )
                    WHERE id = :source_id
                """),
                {
                    "now": datetime.now(timezone.utc),
                    "status": status.value,
                    "current_status": status.value,
                    "found": self._result.opportunities_found,
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
