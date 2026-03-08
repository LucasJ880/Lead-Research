"""FastAPI application for the scraper service."""

from __future__ import annotations

from fastapi import Depends, FastAPI, Header, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from src.core.config import settings
from src.core.logging import get_logger

logger = get_logger(__name__)

app = FastAPI(
    title="LeadHarvest Scraper",
    version="0.1.0",
    docs_url="/docs",
    redoc_url="/redoc",
)

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


# ─── Endpoints ──────────────────────────────────────────────


@app.get("/health", response_model=HealthResponse)
async def health_check() -> HealthResponse:
    """Liveness / readiness probe."""
    return HealthResponse(status="ok", service="scraper")


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
