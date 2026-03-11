"""Quick Analysis API — on-demand Tender Intelligence Report for any opportunity.

Triggered manually from the dashboard. Produces a v2.0 structured report
using opportunity metadata + description text. Stores the full report JSON
in tender_intelligence.intelligence_summary for the frontend to render.
"""

from __future__ import annotations

import json
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import text

from src.api.auth import verify_api_key
from src.core.database import get_db_session
from src.core.logging import get_logger
from src.intelligence.analyzer import TenderAnalyzer

logger = get_logger(__name__)
router = APIRouter(prefix="/api/analysis", tags=["analysis"])


class _Enc(json.JSONEncoder):
    def default(self, o: object) -> object:
        if isinstance(o, (datetime, date)):
            return o.isoformat()
        if isinstance(o, Decimal):
            return float(o)
        return super().default(o)


class AnalyzeRequest(BaseModel):
    opportunity_id: str
    mode: str = "quick"


class AnalyzeResponse(BaseModel):
    status: str
    opportunity_id: str
    overall_score: int | None = None
    recommendation: str | None = None
    confidence: str | None = None
    analysis_model: str | None = None
    message: str | None = None


@router.post("/run", dependencies=[Depends(verify_api_key)])
async def run_quick_analysis(req: AnalyzeRequest) -> AnalyzeResponse:
    """Run on-demand Quick Analysis and produce a Tender Intelligence Report."""
    session = get_db_session()
    try:
        opp = session.execute(
            text("""
                SELECT o.id, o.title, o.description_summary, o.description_full,
                       o.country, o.region, o.city, o.closing_date, o.source_url,
                       o.relevance_score, o.relevance_bucket, o.keywords_matched,
                       o.industry_tags, o.category, o.project_type,
                       o.solicitation_number, o.contact_name, o.contact_email,
                       o.raw_data,
                       s.name as source_name,
                       org.name as organization_name
                FROM opportunities o
                LEFT JOIN sources s ON o.source_id = s.id
                LEFT JOIN organizations org ON o.organization_id = org.id
                WHERE o.id = :id
            """),
            {"id": req.opportunity_id},
        ).fetchone()

        if not opp:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Opportunity not found")

        existing = session.execute(
            text("SELECT id, analyzed_at FROM tender_intelligence WHERE opportunity_id = :id"),
            {"id": req.opportunity_id},
        ).fetchone()

        if existing:
            logger.info("Re-analyzing opportunity %s (previous at %s)", req.opportunity_id, existing.analyzed_at)

        description = opp.description_full or opp.description_summary or ""
        location_parts = [p for p in [opp.city, opp.region, opp.country] if p]
        location = ", ".join(location_parts) if location_parts else None

        raw = opp.raw_data if opp.raw_data else {}
        if isinstance(raw, str):
            try:
                raw = json.loads(raw)
            except Exception:
                raw = {}

        analyzer = TenderAnalyzer(model="gpt-4o-mini")
        result = analyzer.analyze(
            title=opp.title,
            organization=opp.organization_name,
            location=location,
            closing_date=str(opp.closing_date) if opp.closing_date else None,
            source=opp.source_name or "Unknown",
            description=description,
            document_texts=None,
            country=opp.country,
            response_deadline=raw.get("response_deadline"),
            naics=raw.get("naics_code") or opp.category,
            category=opp.category,
            set_aside=raw.get("set_aside"),
            solicitation_number=opp.solicitation_number,
        )

        verdict = result.get("verdict", {})
        scores = result.get("feasibility_scores", {})
        overall = scores.get("overall_score")
        recommendation = verdict.get("recommendation", "review_carefully")
        confidence = verdict.get("confidence", "low")
        analysis_model = result.get("analysis_model", "gpt-4o-mini")
        now = datetime.now(timezone.utc)

        # Extract flattened fields for DB columns
        biz_fit = result.get("business_fit", {})
        scope = result.get("scope_breakdown", {})
        tech = result.get("technical_requirements", {})
        quals = result.get("compliance_risks", {})
        timeline = result.get("timeline_milestones", {})
        risks_list = [rf.get("requirement", "") for rf in result.get("compliance_risks", {}).get("red_flags", [])]
        china = result.get("supply_chain_feasibility", {})

        params = {
            "opp_id": req.opportunity_id,
            "overview": result.get("project_summary", {}).get("overview", ""),
            "scope": json.dumps(scope, cls=_Enc),
            "scope_type": scope.get("scope_type", "unclear"),
            "tech_reqs": json.dumps(tech, cls=_Enc),
            "qual_reqs": json.dumps(quals, cls=_Enc),
            "dates": json.dumps(timeline, cls=_Enc),
            "risks": json.dumps(risks_list, cls=_Enc),
            "feas_score": overall,
            "recommendation": recommendation,
            "biz_fit": biz_fit.get("fit_explanation", "")[:500],
            "china": json.dumps(china, cls=_Enc),
            "summary": json.dumps(result, cls=_Enc),
            "model": analysis_model,
            "now": now,
        }

        if existing:
            session.execute(
                text("""
                    UPDATE tender_intelligence SET
                        project_overview = :overview,
                        scope_of_work = :scope,
                        scope_type = :scope_type,
                        technical_requirements = :tech_reqs,
                        qualification_reqs = :qual_reqs,
                        critical_dates = :dates,
                        risk_factors = :risks,
                        feasibility_score = :feas_score,
                        recommendation_status = :recommendation,
                        business_fit_explanation = :biz_fit,
                        china_source_analysis = :china,
                        intelligence_summary = :summary,
                        analysis_model = :model,
                        analyzed_at = :now,
                        updated_at = :now
                    WHERE opportunity_id = :opp_id
                """),
                params,
            )
        else:
            session.execute(
                text("""
                    INSERT INTO tender_intelligence (
                        opportunity_id, project_overview, scope_of_work, scope_type,
                        technical_requirements, qualification_reqs, critical_dates,
                        risk_factors, feasibility_score, recommendation_status,
                        business_fit_explanation, china_source_analysis,
                        intelligence_summary, analysis_model, analyzed_at, updated_at
                    ) VALUES (
                        :opp_id, :overview, :scope, :scope_type,
                        :tech_reqs, :qual_reqs, :dates,
                        :risks, :feas_score, :recommendation,
                        :biz_fit, :china,
                        :summary, :model, :now, :now
                    )
                """),
                params,
            )

        session.execute(
            text("UPDATE opportunities SET business_fit_explanation = :biz, updated_at = :now WHERE id = :id"),
            {"id": req.opportunity_id, "biz": biz_fit.get("fit_explanation", "")[:500], "now": now},
        )
        session.commit()

        logger.info(
            "Tender Intelligence Report complete: opp=%s score=%s rec=%s conf=%s model=%s",
            req.opportunity_id, overall, recommendation, confidence, analysis_model,
        )

        return AnalyzeResponse(
            status="completed",
            opportunity_id=req.opportunity_id,
            overall_score=overall,
            recommendation=recommendation,
            confidence=confidence,
            analysis_model=analysis_model,
        )

    except HTTPException:
        raise
    except Exception as exc:
        session.rollback()
        logger.exception("Quick analysis failed for %s", req.opportunity_id)
        return AnalyzeResponse(
            status="failed",
            opportunity_id=req.opportunity_id,
            message=str(exc),
        )
    finally:
        session.close()


@router.get("/status/{opportunity_id}", dependencies=[Depends(verify_api_key)])
async def analysis_status(opportunity_id: str) -> dict:
    """Check if an analysis exists for an opportunity."""
    session = get_db_session()
    try:
        row = session.execute(
            text("""
                SELECT id, feasibility_score, recommendation_status,
                       analysis_model, analyzed_at
                FROM tender_intelligence
                WHERE opportunity_id = :id
            """),
            {"id": opportunity_id},
        ).fetchone()
        if row:
            return {
                "exists": True,
                "intel_id": str(row.id),
                "feasibility_score": row.feasibility_score,
                "recommendation": row.recommendation_status,
                "model": row.analysis_model,
                "analyzed_at": row.analyzed_at.isoformat() if row.analyzed_at else None,
            }
        return {"exists": False}
    finally:
        session.close()
