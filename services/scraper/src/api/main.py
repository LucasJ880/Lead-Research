"""FastAPI application for the scraper service."""

from __future__ import annotations

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from src.core.config import settings, validate_startup_config
from src.core.logging import get_logger

logger = get_logger(__name__)

app = FastAPI(
    title="BidToGo Scraper",
    version="0.2.0",
    docs_url="/docs",
    redoc_url="/redoc",
)


@app.on_event("startup")
async def _log_config_warnings() -> None:
    warnings = validate_startup_config()
    for w in warnings:
        logger.warning("CONFIG: %s", w)
    if not warnings:
        logger.info("CONFIG: All required settings present")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

from src.api.auth import verify_api_key
from src.api.agent_sync import router as agent_router
from src.api.quick_analysis import router as analysis_router
from src.api.cron import router as cron_router
from src.api.probe import router as probe_router
from src.models.opportunity import TriggerType
app.include_router(agent_router)
app.include_router(analysis_router)
app.include_router(cron_router)
app.include_router(probe_router)


# ─── Response Models ────────────────────────────────────────


class HealthResponse(BaseModel):
    status: str
    service: str


class CrawlTriggerResponse(BaseModel):
    task_id: str
    source_id: str
    status: str
    # When status == "already_running" this is the existing task id and
    # no new Celery task was dispatched. Clients should treat both
    # statuses as success but may surface different copy.


class CrawlAllResponse(BaseModel):
    task_ids: list[dict[str, str]]
    count: int
    status: str = "dispatched"
    # "dispatched" → fresh task created. "already_running" → an in-flight
    # crawl-all is still active (within the dedup TTL) and we returned
    # its existing task id instead of fanning out duplicates.


class TaskStatusResponse(BaseModel):
    task_id: str
    status: str
    result: dict | None = None


class IntelligenceRequest(BaseModel):
    opportunity_id: str | None = None
    batch: bool = False
    limit: int = 5
    min_relevance: int = 40
    source: str = "MERX"


class IntelligenceResponse(BaseModel):
    results: list[dict]
    count: int


# ─── Endpoints ──────────────────────────────────────────────


@app.get("/health", response_model=HealthResponse)
@app.get("/api/health", response_model=HealthResponse)
async def health_check() -> HealthResponse:
    """Liveness / readiness probe."""
    return HealthResponse(status="ok", service="scraper")


@app.get("/api/diagnostics", dependencies=[Depends(verify_api_key)])
async def diagnostics() -> dict:
    """Return non-secret config diagnostics for debugging parity issues."""
    openai_ready = False
    openai_error = None
    try:
        import openai as _oai
        openai_ready = bool(settings.OPENAI_API_KEY) and hasattr(_oai, "OpenAI")
    except ImportError:
        openai_error = "openai package not installed"
    budget_info = {}
    db = None
    try:
        from src.core.database import get_db_session
        from sqlalchemy import text as sa_text
        db = get_db_session()
        daily = db.execute(sa_text(
            "SELECT COALESCE(SUM(estimated_cost_usd), 0) as total, COUNT(*) as cnt "
            "FROM ai_usage_log WHERE created_at >= CURRENT_DATE"
        )).fetchone()
        monthly = db.execute(sa_text(
            "SELECT COALESCE(SUM(estimated_cost_usd), 0) as total, COUNT(*) as cnt "
            "FROM ai_usage_log WHERE created_at >= date_trunc('month', CURRENT_DATE)"
        )).fetchone()
        budget_info = {
            "daily_spent_usd": float(daily.total) if daily else 0,
            "daily_analyses": daily.cnt if daily else 0,
            "daily_budget_usd": settings.AI_DAILY_BUDGET_USD,
            "monthly_spent_usd": float(monthly.total) if monthly else 0,
            "monthly_analyses": monthly.cnt if monthly else 0,
            "monthly_budget_usd": settings.AI_MONTHLY_BUDGET_USD,
        }
    except Exception as exc:
        budget_info = {"error": str(exc)}
    finally:
        if db is not None:
            db.close()

    return {
        "scraper_api_key_set": bool(settings.SCRAPER_API_KEY),
        "merx_credentials_available": settings.merx_credentials_available,
        "openai_key_set": bool(settings.OPENAI_API_KEY),
        "openai_key_length": len(settings.OPENAI_API_KEY),
        "openai_package_ready": openai_ready,
        "openai_error": openai_error,
        "database_url_set": bool(settings.DATABASE_URL),
        "redis_url": settings.REDIS_URL,
        "rate_limit": settings.DEFAULT_RATE_LIMIT_SECONDS,
        "respect_robots": settings.RESPECT_ROBOTS_TXT,
        "log_level": settings.LOG_LEVEL,
        "ai_budget": budget_info,
    }


@app.post(
    "/api/crawl/all",
    response_model=CrawlAllResponse,
    dependencies=[Depends(verify_api_key)],
)
def trigger_all_crawls() -> CrawlAllResponse:
    """Queue a crawl for every active source.

    Runs are queued as ``pending`` rows in ``source_runs`` and executed one
    per cron tick (``/api/cron/tick``). A source that already has a pending
    or running row is not queued twice.
    """
    from src.core.runner import enqueue_crawl_all

    out = enqueue_crawl_all(TriggerType.MANUAL)
    first = next((t["task_id"] for t in out["task_ids"] if t["task_id"]), "")
    task_ids = [{"master_task_id": first, **t} for t in out["task_ids"]] if out["task_ids"] else []
    logger.info("Queued crawl-all: %d new run(s), status=%s", out["count"], out["status"])
    return CrawlAllResponse(task_ids=task_ids, count=out["count"], status=out["status"])


@app.get(
    "/api/crawl/status/{task_id}",
    response_model=TaskStatusResponse,
    dependencies=[Depends(verify_api_key)],
)
def crawl_status(task_id: str) -> TaskStatusResponse:
    """Return the current status / result of a queued crawl run."""
    from src.core.runner import get_run_status

    info = get_run_status(task_id)
    if info is None:
        return TaskStatusResponse(task_id=task_id, status="PENDING", result=None)
    return TaskStatusResponse(**info)


@app.post(
    "/api/crawl/{source_id}",
    response_model=CrawlTriggerResponse,
    dependencies=[Depends(verify_api_key)],
)
def trigger_crawl(source_id: str) -> CrawlTriggerResponse:
    """Queue a crawl for a single source (executed by the next cron tick)."""
    from src.core.runner import enqueue_crawl

    out = enqueue_crawl(source_id, TriggerType.MANUAL)
    logger.info("Queued crawl for source %s: %s", source_id, out["status"])
    return CrawlTriggerResponse(**out)


@app.post(
    "/api/intelligence/analyze",
    response_model=IntelligenceResponse,
    dependencies=[Depends(verify_api_key)],
)
async def run_intelligence(req: IntelligenceRequest) -> IntelligenceResponse:
    """Run AI intelligence analysis on MERX opportunities."""
    from src.core.database import get_db
    from src.intelligence.merx_pipeline import MerxIntelligencePipeline

    with get_db() as db:
        pipeline = MerxIntelligencePipeline(db)

        if req.opportunity_id:
            result = pipeline.analyze_opportunity(req.opportunity_id)
            return IntelligenceResponse(results=[result], count=1)

        if req.batch:
            results = pipeline.analyze_batch(
                limit=req.limit,
                min_relevance=req.min_relevance,
                source_name=req.source,
            )
            return IntelligenceResponse(results=results, count=len(results))

    return IntelligenceResponse(results=[], count=0)
