"""End-to-end MERX intelligence pipeline.

Orchestrates the full flow for a single MERX opportunity:
  1. Fetch detail page (public)
  2. Extract internal solicitation ID
  3. Login to MERX (authenticated session)
  4. Fetch + download tender documents
  5. Parse document text (PDF/DOCX)
  6. Run AI intelligence analysis
  7. Store results in DB (tender_intelligence + opportunity_documents)

Can be triggered for:
  - A single opportunity by ID
  - All MERX opportunities matching criteria (e.g., highly_relevant, no analysis yet)
"""

from __future__ import annotations

import re
import time
from datetime import datetime, timezone

from bs4 import BeautifulSoup
from sqlalchemy import text
from sqlalchemy.orm import Session

from src.core.config import settings
from src.core.logging import get_logger
from src.crawlers.merx_auth import MerxAuthSession, MerxDocSet
from src.intelligence.doc_parser import extract_text, count_pdf_pages
from src.intelligence.analyzer import TenderAnalyzer

logger = get_logger(__name__)


class MerxIntelligencePipeline:
    """Full intelligence pipeline for MERX opportunities."""

    def __init__(self, db_session: Session) -> None:
        self._db = db_session
        self._auth: MerxAuthSession | None = None
        self._analyzer = TenderAnalyzer()

    def _ensure_auth(self) -> bool:
        """Login if not already authenticated."""
        if self._auth and self._auth.is_authenticated:
            return True
        self._auth = MerxAuthSession()
        return self._auth.login()

    def analyze_opportunity(self, opportunity_id: str) -> dict:
        """Run full intelligence pipeline for a single opportunity.

        Returns a summary dict with results.
        """
        row = self._db.execute(
            text("""
                SELECT o.id, o.title, o.description_full, o.description_summary,
                       o.source_url, o.location_raw,
                       o.closing_date, o.solicitation_number, o.relevance_score,
                       o.raw_data,
                       s.name AS source_name,
                       org.name AS org_name
                FROM opportunities o
                LEFT JOIN sources s ON o.source_id = s.id
                LEFT JOIN organizations org ON o.organization_id = org.id
                WHERE o.id = :id
            """),
            {"id": opportunity_id},
        ).fetchone()

        if not row:
            logger.error("Opportunity %s not found", opportunity_id)
            return {"error": "Opportunity not found"}

        title = row.title
        source_url = row.source_url
        solicitation_number = row.solicitation_number or ""
        description = row.description_full or row.description_summary or ""
        organization = row.org_name or ""
        location = row.location_raw or ""
        closing_date = str(row.closing_date) if row.closing_date else ""

        logger.info("=== Starting intelligence pipeline for: %s ===", title)

        # Step 1: Fetch detail page to get internal ID
        internal_id = self._get_internal_id(source_url)

        # Step 2: Document download (requires auth)
        document_texts: dict[str, str] = {}
        downloaded_docs = []

        if internal_id and settings.merx_credentials_available:
            if self._ensure_auth():
                sol_id = solicitation_number or re.sub(r'[^\w-]', '', title[:40])
                docset = self._auth.download_all_documents(internal_id, sol_id)
                downloaded_docs = docset.documents

                # Step 3: Parse text from downloaded files
                for doc in downloaded_docs:
                    if doc.local_path:
                        text_content = extract_text(doc.local_path)
                        if text_content.strip():
                            document_texts[doc.name] = text_content
                            if doc.file_type == "pdf":
                                doc.page_count = count_pdf_pages(doc.local_path)

                # Store documents in DB
                self._store_documents(opportunity_id, downloaded_docs)
            else:
                logger.warning("MERX auth failed — running analysis without documents")
        else:
            if not internal_id:
                logger.info("No internal ID found — skipping document download")
            if not settings.merx_credentials_available:
                logger.info("MERX credentials not configured — skipping document download")

        # Step 4: AI analysis
        analysis = self._analyzer.analyze(
            title=title,
            organization=organization,
            location=location,
            closing_date=closing_date,
            source=row.source_name or "MERX",
            description=description,
            document_texts=document_texts if document_texts else None,
        )

        # Step 5: Store intelligence
        self._store_intelligence(opportunity_id, analysis)

        # Step 6: Update opportunity fields
        feasibility = analysis.get("feasibility_assessment", {})
        self._update_opportunity_fields(
            opportunity_id,
            feasibility_score=feasibility.get("feasibility_score"),
            recommendation=feasibility.get("recommendation"),
            business_fit=feasibility.get("business_fit_explanation"),
        )

        result = {
            "opportunity_id": opportunity_id,
            "title": title,
            "documents_found": len(downloaded_docs),
            "documents_downloaded": sum(1 for d in downloaded_docs if d.local_path),
            "documents_parsed": len(document_texts),
            "feasibility_score": feasibility.get("feasibility_score"),
            "recommendation": feasibility.get("recommendation"),
            "analysis_model": analysis.get("analysis_model"),
        }

        logger.info(
            "Intelligence pipeline complete: %s | docs=%d/%d | feasibility=%s | rec=%s",
            title,
            result["documents_parsed"], result["documents_found"],
            result["feasibility_score"], result["recommendation"],
        )
        return result

    def analyze_batch(
        self,
        limit: int = 10,
        min_relevance: int = 40,
        source_name: str = "MERX",
    ) -> list[dict]:
        """Run intelligence pipeline for multiple unanalyzed opportunities.

        Selects opportunities that:
        - Come from the specified source
        - Have relevance_score >= min_relevance
        - Don't already have tender_intelligence records
        """
        rows = self._db.execute(
            text("""
                SELECT o.id
                FROM opportunities o
                JOIN sources s ON o.source_id = s.id
                WHERE s.name ILIKE :source
                  AND o.relevance_score >= :min_rel
                  AND NOT EXISTS (
                      SELECT 1 FROM tender_intelligence ti WHERE ti.opportunity_id = o.id
                  )
                ORDER BY o.relevance_score DESC, o.closing_date ASC
                LIMIT :lim
            """),
            {"source": f"%{source_name}%", "min_rel": min_relevance, "lim": limit},
        ).fetchall()

        results = []
        for row in rows:
            try:
                result = self.analyze_opportunity(row.id)
                results.append(result)
                time.sleep(2)
            except Exception as exc:
                logger.error("Failed to analyze %s: %s", row.id, exc)
                results.append({"opportunity_id": row.id, "error": str(exc)})

        logger.info("Batch analysis complete: %d/%d successful", 
                     sum(1 for r in results if "error" not in r), len(results))
        return results

    def _get_internal_id(self, source_url: str) -> str | None:
        """Fetch a detail page and extract the MERX internal solicitation ID."""
        import requests as req
        s = req.Session()
        s.headers.update({
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
            "Accept": "text/html,application/xhtml+xml",
        })
        try:
            s.get("https://www.merx.com", timeout=15)
            time.sleep(1)
            r = s.get(source_url, timeout=15)
            if r.status_code == 200:
                m = re.search(r"/public/solicitations/(\d+)/abstract/", r.text)
                if m:
                    internal_id = m.group(1)
                    logger.info("Found internal ID %s for %s", internal_id, source_url)
                    return internal_id
        except Exception as exc:
            logger.warning("Failed to fetch detail page for internal ID: %s", exc)
        return None

    def _store_documents(self, opportunity_id: str, docs: list) -> None:
        """Insert or update document records in the DB."""
        for doc in docs:
            try:
                self._db.execute(text("SAVEPOINT doc_insert"))
                self._db.execute(
                    text("""
                        INSERT INTO opportunity_documents (
                            opportunity_id, title, url, file_type,
                            file_size_bytes, page_count, local_path,
                            downloaded_at, doc_category
                        ) VALUES (
                            :opp_id, :title, :url, :file_type,
                            :size, :pages, :path,
                            :downloaded_at, :category
                        )
                    """),
                    {
                        "opp_id": opportunity_id,
                        "title": doc.name,
                        "url": doc.url,
                        "file_type": doc.file_type,
                        "size": doc.file_size_bytes,
                        "pages": doc.page_count,
                        "path": doc.local_path,
                        "downloaded_at": doc.downloaded_at,
                        "category": doc.doc_category or "tender_document",
                    },
                )
                self._db.flush()
            except Exception as exc:
                logger.error("Failed to store document %s: %s", doc.name, exc)
                try:
                    self._db.execute(text("ROLLBACK TO SAVEPOINT doc_insert"))
                except Exception:
                    pass

    def _store_intelligence(self, opportunity_id: str, analysis: dict) -> None:
        """Insert or update the tender_intelligence record."""
        feasibility = analysis.get("feasibility_assessment", {})
        china = analysis.get("china_sourcing_analysis", {})
        tech = analysis.get("technical_requirements", {})
        quals = analysis.get("qualification_requirements", {})
        dates = analysis.get("critical_dates", {})
        risks = analysis.get("risk_factors", [])

        import json

        try:
            existing = self._db.execute(
                text("SELECT id FROM tender_intelligence WHERE opportunity_id = :oid"),
                {"oid": opportunity_id},
            ).fetchone()

            if existing:
                self._db.execute(
                    text("""
                        UPDATE tender_intelligence SET
                            project_overview = :overview,
                            scope_of_work = :scope,
                            scope_type = :scope_type,
                            technical_requirements = :tech,
                            qualification_reqs = :quals,
                            critical_dates = :dates,
                            risk_factors = :risks,
                            feasibility_score = :feas_score,
                            recommendation_status = :rec,
                            business_fit_explanation = :biz_fit,
                            china_source_analysis = :china,
                            intelligence_summary = :summary,
                            analysis_model = :model,
                            analyzed_at = :analyzed_at,
                            updated_at = NOW()
                        WHERE opportunity_id = :oid
                    """),
                    self._build_intel_params(opportunity_id, analysis),
                )
            else:
                self._db.execute(
                    text("""
                        INSERT INTO tender_intelligence (
                            opportunity_id, project_overview, scope_of_work, scope_type,
                            technical_requirements, qualification_reqs, critical_dates,
                            risk_factors, feasibility_score, recommendation_status,
                            business_fit_explanation, china_source_analysis,
                            intelligence_summary, analysis_model, analyzed_at
                        ) VALUES (
                            :oid, :overview, :scope, :scope_type,
                            :tech, :quals, :dates,
                            :risks, :feas_score, :rec,
                            :biz_fit, :china,
                            :summary, :model, :analyzed_at
                        )
                    """),
                    self._build_intel_params(opportunity_id, analysis),
                )

            self._db.flush()
            logger.info("Stored intelligence for opportunity %s", opportunity_id)

        except Exception as exc:
            logger.error("Failed to store intelligence: %s", exc)

    def _build_intel_params(self, opportunity_id: str, analysis: dict) -> dict:
        import json
        feasibility = analysis.get("feasibility_assessment", {})
        china = analysis.get("china_sourcing_analysis", {})

        return {
            "oid": opportunity_id,
            "overview": analysis.get("project_overview"),
            "scope": analysis.get("scope_of_work"),
            "scope_type": analysis.get("scope_type"),
            "tech": json.dumps(analysis.get("technical_requirements", {})),
            "quals": json.dumps(analysis.get("qualification_requirements", {})),
            "dates": json.dumps(analysis.get("critical_dates", {})),
            "risks": json.dumps(analysis.get("risk_factors", [])),
            "feas_score": feasibility.get("feasibility_score"),
            "rec": feasibility.get("recommendation"),
            "biz_fit": feasibility.get("business_fit_explanation"),
            "china": json.dumps(china) if china else None,
            "summary": json.dumps(analysis),
            "model": analysis.get("analysis_model"),
            "analyzed_at": datetime.now(timezone.utc),
        }

    def _update_opportunity_fields(
        self,
        opportunity_id: str,
        feasibility_score: int | None = None,
        recommendation: str | None = None,
        business_fit: str | None = None,
    ) -> None:
        """Update the opportunity row with feasibility results."""
        try:
            self._db.execute(
                text("""
                    UPDATE opportunities SET
                        business_fit_explanation = COALESCE(:biz_fit, business_fit_explanation),
                        updated_at = NOW()
                    WHERE id = :oid
                """),
                {"oid": opportunity_id, "biz_fit": business_fit},
            )
            self._db.flush()
        except Exception as exc:
            logger.error("Failed to update opportunity fields: %s", exc)
