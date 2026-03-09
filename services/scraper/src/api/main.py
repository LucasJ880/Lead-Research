"""FastAPI application for the scraper service."""

from __future__ import annotations

from fastapi import Depends, FastAPI, Header, HTTPException, status
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


# ─── Auth Dependency ────────────────────────────────────────


def verify_api_key(x_api_key: str = Header(...)) -> str:
    """Validate the X-API-Key header against the configured secret."""
    if not settings.SCRAPER_API_KEY:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="SCRAPER_API_KEY is not configured",
        )
    if x_api_key != settings.SCRAPER_API_KEY:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid API key",
        )
    return x_api_key


# ─── Response Models ────────────────────────────────────────


class HealthResponse(BaseModel):
    status: str
    service: str


class CrawlTriggerResponse(BaseModel):
    task_id: str
    source_id: str
    status: str


class CrawlAllResponse(BaseModel):
    task_ids: list[dict[str, str]]
    count: int


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
    return {
        "scraper_api_key_set": bool(settings.SCRAPER_API_KEY),
        "merx_credentials_available": settings.merx_credentials_available,
        "openai_key_set": bool(settings.OPENAI_API_KEY),
        "database_url_set": bool(settings.DATABASE_URL),
        "redis_url": settings.REDIS_URL,
        "rate_limit": settings.DEFAULT_RATE_LIMIT_SECONDS,
        "respect_robots": settings.RESPECT_ROBOTS_TXT,
        "log_level": settings.LOG_LEVEL,
    }


@app.post(
    "/api/crawl/all",
    response_model=CrawlAllResponse,
    dependencies=[Depends(verify_api_key)],
)
async def trigger_all_crawls() -> CrawlAllResponse:
    """Dispatch crawl tasks for every active source."""
    from src.tasks.crawl_tasks import crawl_all_active_sources

    task = crawl_all_active_sources.delay()
    logger.info("Dispatched crawl-all task %s", task.id)
    return CrawlAllResponse(
        task_ids=[{"master_task_id": task.id}],
        count=1,
    )


@app.get(
    "/api/crawl/status/{task_id}",
    response_model=TaskStatusResponse,
    dependencies=[Depends(verify_api_key)],
)
async def crawl_status(task_id: str) -> TaskStatusResponse:
    """Return the current status / result of a crawl task."""
    from src.tasks.celery_app import celery_app

    result = celery_app.AsyncResult(task_id)
    response = TaskStatusResponse(
        task_id=task_id,
        status=result.status,
        result=result.result if result.ready() and isinstance(result.result, dict) else None,
    )
    return response


@app.post(
    "/api/crawl/{source_id}",
    response_model=CrawlTriggerResponse,
    dependencies=[Depends(verify_api_key)],
)
async def trigger_crawl(source_id: str) -> CrawlTriggerResponse:
    """Dispatch a crawl task for a single source."""
    from src.tasks.crawl_tasks import crawl_source

    task = crawl_source.delay(source_id)
    logger.info("Dispatched crawl task %s for source %s", task.id, source_id)
    return CrawlTriggerResponse(
        task_id=task.id,
        source_id=source_id,
        status="dispatched",
    )


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
