"""Auto-analyze high-relevance opportunities after ingestion.

When the crawl pipeline creates a new opportunity with relevance_score >= 80,
it dispatches `auto_analyze_opportunity` which:
  1. Extracts text from all attached documents (inline)
  2. Runs TenderAnalyzer in deep mode (GPT-4o, Chinese v3 report)
  3. Stores the report in tender_intelligence
  4. Pushes to Qingyan if enabled (via Next.js push API)

Daily auto-analysis budget is capped to avoid runaway costs.
"""

from __future__ import annotations

import json
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Any

from sqlalchemy import text

from src.core.config import settings
from src.core.database import get_db_session
from src.core.logging import get_logger
from src.tasks.celery_app import celery_app

logger = get_logger(__name__)

AUTO_ANALYZE_DAILY_LIMIT = 15
AUTO_ANALYZE_MODEL = "gpt-4o"
AUTO_ANALYZE_MAX_TOKENS = 8000

_COST_PER_1K_INPUT: dict[str, float] = {
    "gpt-4o-mini": 0.00015,
    "gpt-4o": 0.0025,
}
_COST_PER_1K_OUTPUT: dict[str, float] = {
    "gpt-4o-mini": 0.0006,
    "gpt-4o": 0.01,
}


class _Enc(json.JSONEncoder):
    def default(self, o: object) -> object:
        if isinstance(o, (datetime, date)):
            return o.isoformat()
        if isinstance(o, Decimal):
            return float(o)
        return super().default(o)


def _count_today_auto_analyses(session: Any) -> int:
    row = session.execute(
        text("""
            SELECT COUNT(*) as cnt FROM ai_usage_log
            WHERE analysis_mode = 'auto_deep'
              AND created_at >= CURRENT_DATE
        """),
    ).fetchone()
    return int(row.cnt) if row else 0


def _check_budget(session: Any) -> tuple[bool, str]:
    try:
        today_row = session.execute(
            text("""
                SELECT COALESCE(SUM(estimated_cost_usd), 0) as total
                FROM ai_usage_log WHERE created_at >= CURRENT_DATE
            """),
        ).fetchone()
        daily_spent = float(today_row.total) if today_row else 0.0

        if daily_spent >= settings.AI_DAILY_BUDGET_USD:
            return False, f"日预算已用完 (${daily_spent:.2f}/${settings.AI_DAILY_BUDGET_USD:.2f})"

        month_row = session.execute(
            text("""
                SELECT COALESCE(SUM(estimated_cost_usd), 0) as total
                FROM ai_usage_log
                WHERE created_at >= date_trunc('month', CURRENT_DATE)
            """),
        ).fetchone()
        monthly_spent = float(month_row.total) if month_row else 0.0
        if monthly_spent >= settings.AI_MONTHLY_BUDGET_USD:
            return False, f"月预算已用完 (${monthly_spent:.2f}/${settings.AI_MONTHLY_BUDGET_USD:.2f})"

        return True, ""
    except Exception as exc:
        logger.warning("Budget check failed (allowing): %s", exc)
        return True, ""


def _record_usage(
    session: Any, opportunity_id: str, model: str,
    prompt_tokens: int, completion_tokens: int, estimated_cost: float,
) -> None:
    try:
        session.execute(
            text("""
                INSERT INTO ai_usage_log (
                    opportunity_id, model, analysis_mode,
                    prompt_tokens, completion_tokens, total_tokens,
                    estimated_cost_usd, created_at
                ) VALUES (
                    :opp_id, :model, 'auto_deep',
                    :prompt, :completion, :total, :cost, :ts
                )
            """),
            {
                "opp_id": opportunity_id,
                "model": model,
                "prompt": prompt_tokens,
                "completion": completion_tokens,
                "total": prompt_tokens + completion_tokens,
                "cost": estimated_cost,
                "ts": datetime.now(timezone.utc),
            },
        )
    except Exception as exc:
        logger.warning("Failed to record AI usage: %s", exc)


def _ensure_documents_extracted(session: Any, opportunity_id: str) -> dict[str, str]:
    """Extract un-extracted documents inline, return {name: text} for analysis."""
    from src.api.quick_analysis import _ensure_documents_extracted as _extract_inline
    _extract_inline(session, opportunity_id)

    rows = session.execute(
        text("""
            SELECT title, url, file_type, extracted_text
            FROM opportunity_documents
            WHERE opportunity_id = :opp_id
              AND text_extracted = true
              AND extracted_text IS NOT NULL
              AND LENGTH(extracted_text) > 10
            ORDER BY
                CASE WHEN LOWER(file_type) IN ('pdf','docx','doc','xlsx','xls') THEN 0 ELSE 1 END,
                file_size_bytes DESC NULLS LAST
            LIMIT 15
        """),
        {"opp_id": opportunity_id},
    ).fetchall()

    doc_texts: dict[str, str] = {}
    for i, row in enumerate(rows):
        key = row.title or f"document_{i}"
        doc_texts[key] = row.extracted_text
    return doc_texts


def _push_to_qingyan(session: Any, opportunity_id: str, report: dict) -> bool:
    """Push the analysis report to Qingyan via the Next.js internal API.

    Uses direct HTTP to the Qingyan API from the scraper service, avoiding
    dependency on the Next.js server being up.
    """
    import requests as http_requests

    qingyan_base = settings.QINGYAN_API_BASE if hasattr(settings, "QINGYAN_API_BASE") else ""
    qingyan_token = settings.QINGYAN_API_TOKEN if hasattr(settings, "QINGYAN_API_TOKEN") else ""
    qingyan_enabled = getattr(settings, "QINGYAN_ENABLED", "false")

    if str(qingyan_enabled).lower() != "true" or not qingyan_base or not qingyan_token:
        logger.info("Qingyan push disabled or not configured — skipping")
        return False

    opp = session.execute(
        text("""
            SELECT o.id, o.title, o.title_zh, o.description_summary,
                   o.country, o.region, o.city, o.closing_date,
                   o.estimated_value, o.currency, o.solicitation_number,
                   o.workflow_status, o.relevance_score, o.relevance_bucket,
                   o.keywords_matched,
                   s.name as source_name,
                   org.name as org_name
            FROM opportunities o
            LEFT JOIN sources s ON o.source_id = s.id
            LEFT JOIN organizations org ON o.organization_id = org.id
            WHERE o.id = :id
        """),
        {"id": opportunity_id},
    ).fetchone()

    if not opp:
        logger.warning("Opportunity %s not found for Qingyan push", opportunity_id)
        return False

    existing_sync = session.execute(
        text("SELECT id FROM qingyan_sync WHERE opportunity_id = :id AND sync_status = 'synced'"),
        {"id": opportunity_id},
    ).fetchone()
    if existing_sync:
        logger.info("Opportunity %s already synced to Qingyan — skipping", opportunity_id)
        return False

    verdict = report.get("verdict", {})
    bid_strategy = report.get("bid_strategy", {})
    scores = report.get("feasibility_scores", {})
    fit_score = scores.get("overall_score")

    risk_level = "unassessed"
    if fit_score is not None:
        if fit_score >= 70:
            risk_level = "low"
        elif fit_score >= 40:
            risk_level = "medium"
        else:
            risk_level = "high"

    location_parts = [p for p in [opp.city, opp.region, opp.country] if p]
    title = opp.title_zh or opp.title

    payload = {
        "external_ref": {
            "system": "bidtogo",
            "id": opp.id,
            "url": f"https://bidtogo.ca/dashboard/opportunities/{opp.id}",
        },
        "project": {
            "name": f"[招标] {title}",
            "description": _build_push_description(opp, report),
            "category": "tender_opportunity",
            "priority": "high" if bid_strategy.get("go_no_go") == "建议投标" else "medium",
            "deadline": opp.closing_date.isoformat() if opp.closing_date else None,
            "source_platform": opp.source_name or "Unknown",
            "client_organization": opp.org_name,
            "location": ", ".join(location_parts) if location_parts else None,
            "estimated_value": float(opp.estimated_value) if opp.estimated_value else None,
            "currency": opp.currency or "CAD",
            "solicitation_number": opp.solicitation_number,
        },
        "intelligence": {
            "recommendation": verdict.get("recommendation"),
            "risk_level": risk_level,
            "fit_score": fit_score,
            "summary": verdict.get("one_line"),
            "full_report_url": f"https://bidtogo.ca/dashboard/opportunities/{opp.id}#analysis",
            "full_report": report,
        },
        "documents": [],
        "metadata": {
            "bidtogo_workflow_status": opp.workflow_status or "new",
            "relevance_score": opp.relevance_score or 0,
            "relevance_bucket": opp.relevance_bucket or "irrelevant",
            "keywords_matched": opp.keywords_matched or [],
            "pushed_by": "auto_analyze",
            "pushed_at": datetime.now(timezone.utc).isoformat(),
        },
        "workflow_template": "tender_review",
    }

    try:
        import uuid
        resp = http_requests.post(
            f"{qingyan_base}/api/v1/projects",
            json=payload,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {qingyan_token}",
                "X-Source-System": "bidtogo",
                "X-Request-Id": str(uuid.uuid4()),
            },
            timeout=15,
        )

        if resp.status_code in (200, 201):
            data = resp.json()
            session.execute(
                text("""
                    INSERT INTO qingyan_sync (
                        opportunity_id, sync_status, qingyan_project_id,
                        qingyan_url, pushed_at, last_sync_at, pushed_by
                    ) VALUES (
                        :opp_id, 'synced', :proj_id, :proj_url, :now, :now, 'auto_analyze'
                    )
                    ON CONFLICT (opportunity_id) DO UPDATE SET
                        sync_status = 'synced',
                        qingyan_project_id = :proj_id,
                        qingyan_url = :proj_url,
                        pushed_at = :now,
                        last_sync_at = :now
                """),
                {
                    "opp_id": opportunity_id,
                    "proj_id": data.get("project_id", ""),
                    "proj_url": data.get("project_url", ""),
                    "now": datetime.now(timezone.utc),
                },
            )
            logger.info("Auto-pushed to Qingyan: opp=%s project=%s", opportunity_id, data.get("project_id"))
            return True

        if resp.status_code == 409:
            logger.info("Qingyan duplicate for %s — already exists", opportunity_id)
            return False

        logger.warning("Qingyan push failed: status=%d body=%s", resp.status_code, resp.text[:200])
        return False

    except Exception as exc:
        logger.warning("Qingyan push error for %s: %s", opportunity_id, exc)
        return False


def _build_push_description(opp: Any, report: dict) -> str:
    verdict = report.get("verdict", {})
    summary = report.get("project_summary", {})
    bid_strat = report.get("bid_strategy", {})
    scores = report.get("feasibility_scores", {})

    parts = [
        f"## {verdict.get('one_line', '')}",
        "",
        f"**项目概述**: {summary.get('overview', '无')}",
        f"**投标建议**: {bid_strat.get('go_no_go', '未评估')}",
        f"**中标概率**: {bid_strat.get('win_probability', '未评估')}",
        f"**综合评分**: {scores.get('overall_score', 'N/A')}/100",
        "",
        f"**决策依据**: {bid_strat.get('go_no_go_rationale', '详见完整报告')}",
    ]

    action_items = report.get("action_items", [])
    if action_items:
        parts.append("")
        parts.append("## 待办事项")
        for item in action_items[:5]:
            parts.append(f"- [{item.get('priority', 'medium')}] {item.get('action', '')}")

    return "\n".join(parts)


@celery_app.task(
    name="src.tasks.auto_analyze.auto_analyze_opportunity",
    bind=True,
    max_retries=2,
    default_retry_delay=60,
    soft_time_limit=300,
    time_limit=360,
)
def auto_analyze_opportunity(self: Any, opportunity_id: str) -> dict[str, Any]:
    """Run deep AI analysis on a single high-relevance opportunity."""
    session = get_db_session()
    try:
        today_count = _count_today_auto_analyses(session)
        if today_count >= AUTO_ANALYZE_DAILY_LIMIT:
            msg = f"日自动分析上限已达 ({today_count}/{AUTO_ANALYZE_DAILY_LIMIT})"
            logger.warning(msg)
            return {"status": "skipped", "reason": msg}

        budget_ok, budget_msg = _check_budget(session)
        if not budget_ok:
            logger.warning("Auto-analysis budget exceeded: %s", budget_msg)
            return {"status": "skipped", "reason": budget_msg}

        existing = session.execute(
            text("""
                SELECT id, analysis_mode FROM tender_intelligence
                WHERE opportunity_id = :id
            """),
            {"id": opportunity_id},
        ).fetchone()

        if existing and existing.analysis_mode in ("deep", "auto_deep"):
            logger.info("Deep analysis already exists for %s — skipping", opportunity_id)
            return {"status": "skipped", "reason": "already_analyzed"}

        opp = session.execute(
            text("""
                SELECT o.id, o.title, o.description_summary, o.description_full,
                       o.country, o.region, o.city, o.closing_date, o.source_url,
                       o.relevance_score, o.category, o.project_type,
                       o.solicitation_number, o.raw_data,
                       s.name as source_name,
                       org.name as organization_name
                FROM opportunities o
                LEFT JOIN sources s ON o.source_id = s.id
                LEFT JOIN organizations org ON o.organization_id = org.id
                WHERE o.id = :id
            """),
            {"id": opportunity_id},
        ).fetchone()

        if not opp:
            logger.warning("Opportunity %s not found for auto-analysis", opportunity_id)
            return {"status": "error", "reason": "not_found"}

        logger.info(
            "Auto-analyzing opportunity: id=%s title='%s' score=%s",
            opportunity_id, (opp.title or "")[:60], opp.relevance_score,
        )

        from src.tasks.discover_documents import discover_documents_for_opportunity_sync
        discovered = discover_documents_for_opportunity_sync(session, opportunity_id)
        if discovered:
            logger.info("Document discovery found %d new documents for %s", discovered, opportunity_id)

        doc_texts = _ensure_documents_extracted(session, opportunity_id)
        logger.info("Documents for analysis: %d files, %d total chars",
                     len(doc_texts), sum(len(v) for v in doc_texts.values()))

        description = opp.description_full or opp.description_summary or ""
        location_parts = [p for p in [opp.city, opp.region, opp.country] if p]
        location = ", ".join(location_parts) if location_parts else None

        raw = opp.raw_data if opp.raw_data else {}
        if isinstance(raw, str):
            try:
                raw = json.loads(raw)
            except Exception:
                raw = {}

        from src.intelligence.analyzer import TenderAnalyzer
        analyzer = TenderAnalyzer(model=AUTO_ANALYZE_MODEL, max_tokens=AUTO_ANALYZE_MAX_TOKENS)
        result = analyzer.analyze(
            title=opp.title,
            organization=opp.organization_name,
            location=location,
            closing_date=str(opp.closing_date) if opp.closing_date else None,
            source=opp.source_name or "Unknown",
            description=description,
            document_texts=doc_texts if doc_texts else None,
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
        now = datetime.now(timezone.utc)

        prompt_tok = result.pop("_prompt_tokens", 0)
        completion_tok = result.pop("_completion_tokens", 0)
        if not fallback_used:
            cost = (prompt_tok / 1000) * _COST_PER_1K_INPUT.get(AUTO_ANALYZE_MODEL, 0.003) + \
                   (completion_tok / 1000) * _COST_PER_1K_OUTPUT.get(AUTO_ANALYZE_MODEL, 0.006)
            _record_usage(session, opportunity_id, AUTO_ANALYZE_MODEL, prompt_tok, completion_tok, round(cost, 6))

        biz_fit = result.get("business_fit", {})
        scope = result.get("scope_breakdown", {})
        tech = result.get("technical_requirements", {})
        quals = result.get("compliance_risks", {})
        timeline = result.get("timeline_milestones", {})
        risks_list = [rf.get("requirement", "") for rf in quals.get("red_flags", [])]
        china = result.get("supply_chain_feasibility", {})

        params = {
            "opp_id": opportunity_id,
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
            "model": AUTO_ANALYZE_MODEL,
            "mode": "auto_deep",
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
            {"id": opportunity_id, "biz": biz_fit.get("fit_explanation", "")[:500], "now": now},
        )
        session.commit()

        pushed = _push_to_qingyan(session, opportunity_id, result)
        if pushed:
            session.commit()

        logger.info(
            "Auto-analysis complete: opp=%s score=%s rec=%s model=%s pushed=%s",
            opportunity_id, overall, recommendation, AUTO_ANALYZE_MODEL, pushed,
        )

        return {
            "status": "completed",
            "opportunity_id": opportunity_id,
            "overall_score": overall,
            "recommendation": recommendation,
            "fallback_used": fallback_used,
            "pushed_to_qingyan": pushed,
        }

    except Exception as exc:
        session.rollback()
        logger.exception("Auto-analysis failed for %s", opportunity_id)
        try:
            self.retry(exc=exc)
        except self.MaxRetriesExceededError:
            pass
        return {"status": "error", "reason": str(exc)}
    finally:
        session.close()
