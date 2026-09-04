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


def _status_value(status: object) -> str:
    """Enum or plain-string status → DB enum label."""
    if status is None:
        return "unknown"
    return str(getattr(status, "value", status)).lower() or "unknown"


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
    normalize_procurement_type,
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
        self._time_budget: float | None = None
        self._deadline: float | None = None

    def run(
        self,
        triggered_by: TriggerType = TriggerType.SCHEDULE,
        source_run_id: str | None = None,
        time_budget_seconds: float | None = None,
    ) -> CrawlResult:
        """Execute the full pipeline and return a summary.

        Args:
            triggered_by: What initiated this crawl (schedule, manual, retry).
            source_run_id: Reuse an existing (queued) ``source_runs`` row instead
                of inserting a new one. Used by the serverless job runner.
            time_budget_seconds: Hard wall-clock budget for the whole run. The
                crawler gets ~60% of it and stops early (returning partial
                results, resumable via the keyword cursor); processing uses the
                rest. ``None`` means unlimited.

        Returns:
            CrawlResult with aggregate statistics.
        """
        pipeline_start = _time.monotonic()
        self._time_budget = time_budget_seconds
        self._deadline = pipeline_start + time_budget_seconds if time_budget_seconds else None
        access_mode = getattr(self._source_config, "access_mode", "http")
        logger.info(
            "Pipeline starting for source '%s' [access_mode=%s, triggered_by=%s]",
            self._source_config.name, access_mode, triggered_by.value,
        )

        if source_run_id:
            self._claim_source_run(source_run_id, triggered_by)
        else:
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
            processed = 0
            for opp in raw_opportunities:
                if self._deadline is not None and _time.monotonic() >= self._deadline:
                    logger.warning(
                        "Time budget exhausted after processing %d/%d opportunities; "
                        "the rest will be picked up on the next crawl",
                        processed, len(raw_opportunities),
                    )
                    self._crawler_diagnostics["processing_truncated"] = len(raw_opportunities) - processed
                    break
                try:
                    opp = self._normalize(opp)
                    opp = self._score(opp)
                    opp.source_run_id = source_run_id
                    zh_fields = self._translate_if_relevant(opp)
                    self._dedup_and_store(opp, zh_fields=zh_fields)
                    # Commit per row so an aborted invocation keeps what it stored.
                    self._session.commit()
                except Exception as exc:
                    self._session.rollback()
                    self._result.errors.append(f"Processing error: {exc}")
                    logger.exception("Error processing opportunity: %s", opp.title)
                processed += 1
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

        if self._deadline is not None:
            # Leave ~40% of the budget for normalize/score/translate/store.
            crawler.deadline = _time.monotonic() + max(10.0, (self._deadline - _time.monotonic()) * 0.6)

        opportunities = crawler.crawl()

        self._crawler_diagnostics = {}
        if getattr(crawler, "deadline_hit", False):
            self._crawler_diagnostics["crawl_truncated"] = True
        cursor = getattr(crawler, "next_keyword_cursor", None)
        if cursor is not None:
            self._crawler_diagnostics["keyword_cursor"] = cursor
            self._crawler_diagnostics["keywords_completed"] = bool(getattr(crawler, "keywords_completed", True))
            self._persist_keyword_cursor(cursor)

        diagnostics_fn = getattr(crawler, "diagnostics", None)
        if callable(diagnostics_fn):
            try:
                self._crawler_diagnostics.update(diagnostics_fn() or {})
            except Exception:
                logger.exception("Failed to read crawler diagnostics for %s", self._source_config.name)
        self._result.pages_crawled = self._source_config.crawl_config.get(
            "max_pages", settings.DEFAULT_MAX_PAGES_PER_SOURCE
        )
        return opportunities

    def _normalize(self, opp: OpportunityCreate) -> OpportunityCreate:
        """Apply normalization to dates, location, status, and currency."""
        if opp.closing_date is None and opp.raw_data and opp.raw_data.get("closing_date"):
            parsed = normalize_date(opp.raw_data["closing_date"])
            if parsed:
                # Date-only deadlines mean "by end of that day"
                opp.closing_date = datetime(
                    parsed.year, parsed.month, parsed.day, 23, 59, 59, tzinfo=timezone.utc
                )

        if opp.posted_date is None and opp.raw_data and opp.raw_data.get("posted_date"):
            opp.posted_date = normalize_date(opp.raw_data["posted_date"])

        if opp.location_raw and not opp.region:
            loc = normalize_location(opp.location_raw, opp.country or self._source_config.country)
            opp.country = loc["country"] or opp.country
            opp.region = loc["region"] or opp.region
            opp.city = loc["city"] or opp.city

        if opp.raw_data and opp.raw_data.get("status"):
            # normalize_status returns a plain string; keep the enum on the model
            # (an unknown value must not override a status the crawler already set)
            from src.models.opportunity import OpportunityStatus

            normalized = normalize_status(str(opp.raw_data["status"]))
            try:
                candidate = OpportunityStatus(normalized)
            except ValueError:
                candidate = OpportunityStatus.UNKNOWN
            if candidate != OpportunityStatus.UNKNOWN:
                opp.status = candidate

        if opp.estimated_value is None and opp.raw_data and opp.raw_data.get("estimated_value"):
            amount, currency = normalize_currency(opp.raw_data["estimated_value"])
            if amount is not None:
                opp.estimated_value = amount
                opp.currency = currency

        if opp.description_full:
            opp.description_full = clean_html(opp.description_full)

        # Canadian sources quote CAD unless the crawler said otherwise
        if (opp.country or self._source_config.country or "").upper() == "CA" and (
            not opp.currency or opp.currency == "USD"
        ) and not (opp.raw_data or {}).get("currency"):
            opp.currency = "CAD"

        # Procurement type (RFP/RFQ/tender/...) inferred from the title / source metadata
        try:
            ptype = normalize_procurement_type(
                opp.title,
                (opp.raw_data or {}).get("procurement_type") or (opp.raw_data or {}).get("notice_type"),
                opp.description_summary,
            )
            opp.raw_data = dict(opp.raw_data or {})
            opp.raw_data["_procurement"] = ptype
        except Exception:
            logger.debug("procurement type inference failed", exc_info=True)

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
        ptype = ((opp.raw_data or {}).get("_procurement") or {}).get("procurement_type")
        score, breakdown = score_opportunity(
            title=opp.title,
            description=description,
            org_type=None,
            project_type=opp.project_type,
            category=opp.category,
            source_fit_score=source_fit,
            procurement_type=ptype,
            country=(opp.country or self._source_config.country or None),
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
        return True

    @staticmethod
    def _is_closed(opp: OpportunityCreate) -> bool:
        from src.models.opportunity import OpportunityStatus

        return opp.status in (OpportunityStatus.CLOSED, OpportunityStatus.AWARDED, OpportunityStatus.CANCELLED)

    def _translate_if_relevant(self, opp: OpportunityCreate) -> dict | None:
        """Translate title/descriptions to Chinese if relevance >= 70 (highly_relevant)."""
        if opp.relevance_score < 70:
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

        opp.organization_id = self._resolve_organization(opp)

        # Check by source + external ID first, then by fingerprint
        existing_id = None
        if opp.external_id:
            existing_id = check_source_duplicate(
                self._session, opp.source_id, opp.external_id
            )
        if not existing_id:
            existing_id = check_duplicate(self._session, opp.fingerprint)

        if existing_id:
            # Re-crawls refresh the row (status, deadline, docs, scores); user-owned
            # workflow fields are never touched by _update_opportunity.
            self._update_opportunity(existing_id, opp, zh_fields=zh_fields)
            return

        if self._is_closed(opp):
            logger.debug("Not inserting already-closed opportunity: %s", opp.title[:60])
            self._result.opportunities_skipped += 1
            return

        self._insert_opportunity(opp, zh_fields=zh_fields)

    def _resolve_organization(self, opp: OpportunityCreate) -> str | None:
        """Find-or-create the buyer organization so it can be joined/filtered on."""
        name = (opp.organization_name or "").strip()
        if not name:
            return opp.organization_id
        normalized = " ".join(name.lower().split())[:500]
        country = (opp.country or self._source_config.country or None)
        region = opp.region or None
        try:
            row = self._session.execute(
                text("""
                    SELECT id FROM organizations
                    WHERE name_normalized = :n AND country IS NOT DISTINCT FROM :c AND region IS NOT DISTINCT FROM :r
                    LIMIT 1
                """),
                {"n": normalized, "c": country, "r": region},
            ).fetchone()
            if row:
                return str(row.id)
            row = self._session.execute(
                text("""
                    INSERT INTO organizations (name, name_normalized, country, region, city, updated_at)
                    VALUES (:name, :n, :c, :r, :city, NOW())
                    ON CONFLICT (name_normalized, country, region) DO UPDATE SET updated_at = NOW()
                    RETURNING id
                """),
                {"name": name[:500], "n": normalized, "c": country, "r": region, "city": opp.city},
            ).fetchone()
            return str(row.id) if row else None
        except Exception:
            logger.debug("organization resolution failed for %r", name, exc_info=True)
            return opp.organization_id

    # ─── Database Operations ────────────────────────────────

    def _insert_opportunity(self, opp: OpportunityCreate, *, zh_fields: dict | None = None) -> None:
        """Insert a new opportunity row using a SAVEPOINT for isolation."""
        zh = zh_fields or {}
        try:
            self._session.execute(text("SAVEPOINT opp_insert"))
            self._session.execute(
                text("""
                    INSERT INTO opportunities (
                        organization_id, procurement_type, procurement_type_source,
                        procurement_type_confidence, business_fit_explanation,
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
                        :organization_id, :procurement_type, :procurement_type_source,
                        :procurement_type_confidence, :business_fit_explanation,
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
                    **self._enrichment_params(opp),
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
                    "status": _status_value(opp.status),
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
                        posted_date = COALESCE(posted_date, :posted_date),
                        country = COALESCE(country, :country),
                        region = COALESCE(region, :region),
                        city = COALESCE(city, :city),
                        location_raw = COALESCE(location_raw, :location_raw),
                        category = COALESCE(:category, category),
                        project_type = COALESCE(:project_type, project_type),
                        solicitation_number = COALESCE(:solicitation_number, solicitation_number),
                        currency = COALESCE(:currency, currency),
                        source_url = COALESCE(:source_url, source_url),
                        procurement_type = COALESCE(:procurement_type, procurement_type),
                        procurement_type_source = COALESCE(:procurement_type_source, procurement_type_source),
                        procurement_type_confidence = COALESCE(:procurement_type_confidence, procurement_type_confidence),
                        business_fit_explanation = COALESCE(:business_fit_explanation, business_fit_explanation),
                        addenda_count = GREATEST(addenda_count, :addenda_count),
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
                    **self._enrichment_params(opp),
                    "id": opportunity_id,
                    "posted_date": opp.posted_date,
                    "country": opp.country,
                    "region": opp.region,
                    "city": opp.city,
                    "location_raw": opp.location_raw,
                    "category": opp.category,
                    "project_type": opp.project_type,
                    "solicitation_number": opp.solicitation_number,
                    "currency": opp.currency,
                    "source_url": opp.source_url,
                    "addenda_count": opp.addenda_count or 0,
                    "source_run_id": opp.source_run_id,
                    "title": opp.title,
                    "description_summary": opp.description_summary,
                    "description_full": opp.description_full,
                    "title_zh": zh.get("title_zh"),
                    "summary_zh": zh.get("summary_zh"),
                    "full_zh": zh.get("full_zh"),
                    "translated_at": datetime.now(timezone.utc) if zh else None,
                    "status": _status_value(opp.status),
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
            if opp.organization_id:
                # Only fill in a missing buyer link; never re-point an existing one.
                self._session.execute(
                    text("UPDATE opportunities SET organization_id = :org WHERE id = :id AND organization_id IS NULL"),
                    {"org": opp.organization_id, "id": opportunity_id},
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

    @staticmethod
    def _enrichment_params(opp: OpportunityCreate) -> dict:
        ptype = (opp.raw_data or {}).get("_procurement") or {}
        conf = ptype.get("procurement_type_confidence")
        return {
            "organization_id": opp.organization_id,
            "procurement_type": ptype.get("procurement_type"),
            "procurement_type_source": ptype.get("procurement_type_source"),
            "procurement_type_confidence": float(conf) if conf is not None else None,
            "business_fit_explanation": (opp.relevance_breakdown or {}).get("business_fit_explanation"),
        }

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

    def _persist_keyword_cursor(self, cursor: int) -> None:
        """Store the keyword round-robin position in ``sources.crawl_config``."""
        try:
            self._session.execute(
                text("""
                    UPDATE sources
                    SET crawl_config = COALESCE(crawl_config, '{}'::jsonb) || CAST(:patch AS jsonb)
                    WHERE id = :id
                """),
                {"id": self._source_config.id, "patch": json.dumps({"keyword_cursor": int(cursor)})},
            )
            self._session.commit()
        except Exception:
            self._session.rollback()
            logger.exception("Failed to persist keyword cursor for %s", self._source_config.id)

    def _claim_source_run(self, run_id: str, triggered_by: TriggerType) -> None:
        """Mark a queued source_run as running (serverless job runner path)."""
        self._session.execute(
            text("""
                UPDATE source_runs
                SET status = :status, started_at = :started_at, triggered_by = :triggered_by
                WHERE id = :id
            """),
            {
                "id": run_id,
                "status": RunStatus.RUNNING.value,
                "started_at": datetime.now(timezone.utc),
                "triggered_by": triggered_by.value,
            },
        )
        self._session.commit()
        logger.info("Claimed queued source_run %s for source %s", run_id, self._source_config.id)

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
        self._session.commit()
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
