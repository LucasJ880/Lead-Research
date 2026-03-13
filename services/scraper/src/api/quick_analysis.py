"""Quick Analysis API — on-demand Tender Intelligence Report for any opportunity.

Triggered manually from the dashboard. Produces a v2.0 structured report
using opportunity metadata + description text. Stores the full report JSON
in tender_intelligence.intelligence_summary for the frontend to render.

Cost control: AI analysis is ONLY user-triggered, never automatic.
Budget limits are enforced per-day and per-month.
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

_COST_PER_1K_INPUT: dict[str, float] = {
    "gpt-4o-mini": 0.00015,
    "gpt-4o": 0.0025,
}
_COST_PER_1K_OUTPUT: dict[str, float] = {
    "gpt-4o-mini": 0.0006,
    "gpt-4o": 0.01,
}


def _estimate_cost(model: str, prompt_tokens: int, completion_tokens: int) -> float:
    input_cost = (prompt_tokens / 1000) * _COST_PER_1K_INPUT.get(model, 0.003)
    output_cost = (completion_tokens / 1000) * _COST_PER_1K_OUTPUT.get(model, 0.006)
    return round(input_cost + output_cost, 6)


def _check_budget(session: Any, mode: str) -> tuple[bool, str]:
    """Check daily and monthly AI budget limits. Returns (ok, message)."""
    try:
        today_row = session.execute(
            text("""
                SELECT COALESCE(SUM(estimated_cost_usd), 0) as total
                FROM ai_usage_log
                WHERE created_at >= CURRENT_DATE
            """),
        ).fetchone()
        daily_spent = float(today_row.total) if today_row else 0.0

        month_row = session.execute(
            text("""
                SELECT COALESCE(SUM(estimated_cost_usd), 0) as total
                FROM ai_usage_log
                WHERE created_at >= date_trunc('month', CURRENT_DATE)
            """),
        ).fetchone()
        monthly_spent = float(month_row.total) if month_row else 0.0

        if daily_spent >= settings.AI_DAILY_BUDGET_USD:
            return False, f"Daily AI budget reached (${daily_spent:.2f} / ${settings.AI_DAILY_BUDGET_USD:.2f}). Try again tomorrow."
        if monthly_spent >= settings.AI_MONTHLY_BUDGET_USD:
            return False, f"Monthly AI budget reached (${monthly_spent:.2f} / ${settings.AI_MONTHLY_BUDGET_USD:.2f}). Contact admin."

        return True, ""
    except Exception as exc:
        logger.warning("Budget check failed (allowing analysis): %s", exc)
        return True, ""


def _record_usage(
    session: Any,
    opportunity_id: str,
    model: str,
    mode: str,
    prompt_tokens: int,
    completion_tokens: int,
    estimated_cost: float,
    ts: datetime,
) -> None:
    """Log AI usage for budget tracking."""
    try:
        session.execute(
            text("""
                INSERT INTO ai_usage_log (
                    opportunity_id, model, analysis_mode,
                    prompt_tokens, completion_tokens, total_tokens,
                    estimated_cost_usd, created_at
                ) VALUES (
                    :opp_id, :model, :mode,
                    :prompt, :completion, :total,
                    :cost, :ts
                )
            """),
            {
                "opp_id": opportunity_id,
                "model": model,
                "mode": mode,
                "prompt": prompt_tokens,
                "completion": completion_tokens,
                "total": prompt_tokens + completion_tokens,
                "cost": estimated_cost,
                "ts": ts,
            },
        )
    except Exception as exc:
        logger.warning("Failed to record AI usage: %s", exc)


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

        doc_rows = session.execute(
            text("""
                SELECT title, extracted_text FROM opportunity_documents
                WHERE opportunity_id = :id AND text_extracted = true
                  AND extracted_text IS NOT NULL AND LENGTH(extracted_text) > 10
                ORDER BY file_size_bytes DESC NULLS LAST
                LIMIT 10
            """),
            {"id": req.opportunity_id},
        ).fetchall()
        document_texts: dict[str, str] | None = None
        if doc_rows:
            document_texts = {
                (row.title or f"document_{i}"): row.extracted_text
                for i, row in enumerate(doc_rows)
            }
            logger.info("Including %d document(s) with extracted text for analysis", len(document_texts))

        budget_ok, budget_msg = _check_budget(session, req.mode)
        if not budget_ok:
            logger.warning("AI budget exceeded: %s", budget_msg)
            return AnalyzeResponse(
                status="budget_exceeded",
                opportunity_id=req.opportunity_id,
                message=budget_msg,
            )

        use_model = "gpt-4o" if req.mode == "deep" else "gpt-4o-mini"
        max_tok = 6000 if req.mode == "deep" else 3500
        analyzer = TenderAnalyzer(model=use_model, max_tokens=max_tok)
        result = analyzer.analyze(
            title=opp.title,
            organization=opp.organization_name,
            location=location,
            closing_date=str(opp.closing_date) if opp.closing_date else None,
            source=opp.source_name or "Unknown",
            description=description,
            document_texts=document_texts,
            country=opp.country,
            response_deadline=raw.get("response_deadline"),
            naics=raw.get("naics_code") or opp.category,
            category=opp.category,
            set_aside=raw.get("set_aside"),
            solicitation_number=opp.solicitation_number,
        )

        fallback_used = result.get("fallback_used", False)
        verdict = result.get("verdict", {})
        scores = result.get("feasibility_scores", {})
        overall = scores.get("overall_score")
        recommendation = verdict.get("recommendation", "review_carefully")
        confidence = verdict.get("confidence", "low")
        analysis_model = result.get("analysis_model", "gpt-4o-mini")
        now = datetime.now(timezone.utc)

        prompt_tok = result.get("_prompt_tokens", 0)
        completion_tok = result.get("_completion_tokens", 0)
        est_cost = _estimate_cost(use_model, prompt_tok, completion_tok) if not fallback_used else 0.0

        if not fallback_used and est_cost > 0:
            _record_usage(session, req.opportunity_id, use_model, req.mode, prompt_tok, completion_tok, est_cost, now)

        if fallback_used:
            logger.warning(
                "Analysis used FALLBACK for opp=%s — OpenAI did not produce the report",
                req.opportunity_id,
            )

        result.pop("_prompt_tokens", None)
        result.pop("_completion_tokens", None)

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
            "mode": req.mode,
            "status": "completed" if not fallback_used else "fallback_only",
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
                        analysis_mode = :mode,
                        analysis_status = :status,
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
                        intelligence_summary, analysis_model, analysis_mode,
                        analysis_status, analyzed_at, updated_at
                    ) VALUES (
                        :opp_id, :overview, :scope, :scope_type,
                        :tech_reqs, :qual_reqs, :dates,
                        :risks, :feas_score, :recommendation,
                        :biz_fit, :china,
                        :summary, :model, :mode,
                        :status, :now, :now
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
