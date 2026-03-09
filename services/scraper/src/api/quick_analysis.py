"""Quick Analysis API — on-demand AI analysis for any opportunity.

Triggered manually from the dashboard. Runs GPT analysis using the
opportunity's title, description, organization, location, and dates.
Stores the result in tender_intelligence for future retrieval.

Does NOT auto-analyze. Only runs when explicitly requested.
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
from src.core.config import settings
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
    mode: str = "quick"  # quick | deep (only quick for now)


class AnalyzeResponse(BaseModel):
    status: str
    opportunity_id: str
    feasibility_score: int | None = None
    recommendation: str | None = None
    analysis_model: str | None = None
    message: str | None = None


@router.post("/run", dependencies=[Depends(verify_api_key)])
async def run_quick_analysis(req: AnalyzeRequest) -> AnalyzeResponse:
    """Run on-demand Quick Analysis for a single opportunity."""
    session = get_db_session()
    try:
        opp = session.execute(
            text("""
                SELECT o.id, o.title, o.description_summary, o.description_full,
                       o.country, o.region, o.city, o.closing_date, o.source_url,
                       o.relevance_score, o.relevance_bucket, o.keywords_matched,
                       o.industry_tags, o.category, o.project_type,
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
            logger.info("Re-analyzing opportunity %s (previous analysis at %s)", req.opportunity_id, existing.analyzed_at)

        description = opp.description_full or opp.description_summary or ""
        location_parts = [p for p in [opp.city, opp.region, opp.country] if p]
        location = ", ".join(location_parts) if location_parts else "Unknown"

        analyzer = TenderAnalyzer(model="gpt-4o-mini")
        result = analyzer.analyze(
            title=opp.title,
            organization=opp.organization_name,
            location=location,
            closing_date=str(opp.closing_date) if opp.closing_date else None,
            source=opp.source_name or "Unknown",
            description=description,
            document_texts=None,
        )

        feasibility = result.get("feasibility_assessment", {})
        feas_score = feasibility.get("feasibility_score")
        recommendation = feasibility.get("recommendation", "review_carefully")
        analysis_model = result.get("analysis_model", "gpt-4o-mini")
        now = datetime.now(timezone.utc)

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
                _build_intel_params(req.opportunity_id, result, feas_score, recommendation, analysis_model, now),
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
                _build_intel_params(req.opportunity_id, result, feas_score, recommendation, analysis_model, now),
            )

        session.execute(
            text("""
                UPDATE opportunities SET
                    business_fit_explanation = :biz_fit,
                    updated_at = :now
                WHERE id = :opp_id
            """),
            {
                "opp_id": req.opportunity_id,
                "biz_fit": feasibility.get("business_fit_explanation", "")[:500],
                "now": now,
            },
        )

        session.commit()
        logger.info(
            "Quick analysis complete: opp=%s feas=%s rec=%s model=%s",
            req.opportunity_id, feas_score, recommendation, analysis_model,
        )

        return AnalyzeResponse(
            status="completed",
            opportunity_id=req.opportunity_id,
            feasibility_score=feas_score,
            recommendation=recommendation,
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


def _build_intel_params(
    opp_id: str, result: dict[str, Any],
    feas_score: int | None, recommendation: str,
    model: str, now: datetime,
) -> dict[str, Any]:
    feasibility = result.get("feasibility_assessment", {})
    china = result.get("china_sourcing_analysis", {})
    return {
        "opp_id": opp_id,
        "overview": result.get("project_overview", ""),
        "scope": result.get("scope_of_work", ""),
        "scope_type": result.get("scope_type", "unclear"),
        "tech_reqs": json.dumps(result.get("technical_requirements", {}), cls=_Enc),
        "qual_reqs": json.dumps(result.get("qualification_requirements", {}), cls=_Enc),
        "dates": json.dumps(result.get("critical_dates", {}), cls=_Enc),
        "risks": json.dumps(result.get("risk_factors", []), cls=_Enc),
        "feas_score": feas_score,
        "recommendation": recommendation,
        "biz_fit": feasibility.get("business_fit_explanation", ""),
        "china": json.dumps(china, cls=_Enc) if china else None,
        "summary": json.dumps(result, cls=_Enc),
        "model": model,
        "now": now,
    }
