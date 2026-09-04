"""Cron entry point for serverless hosting (Vercel Cron → GET /api/cron/tick)."""

from __future__ import annotations

import hmac

from fastapi import APIRouter, Header, HTTPException

from src.core.config import settings
from src.core.logging import get_logger
from src.core.runner import tick

logger = get_logger(__name__)
router = APIRouter(prefix="/api/cron", tags=["cron"])


def _authorize(authorization: str | None, x_api_key: str | None) -> None:
    """Accept Vercel's ``Authorization: Bearer $CRON_SECRET`` or the scraper API key."""
    cron_secret = settings.CRON_SECRET
    if cron_secret and authorization:
        token = authorization.split(" ", 1)[1] if authorization.lower().startswith("bearer ") else authorization
        if hmac.compare_digest(token, cron_secret):
            return
    if settings.SCRAPER_API_KEY and x_api_key and hmac.compare_digest(x_api_key, settings.SCRAPER_API_KEY):
        return
    raise HTTPException(status_code=401, detail="Unauthorized")


@router.get("/tick")
@router.post("/tick")
def cron_tick(
    authorization: str | None = Header(default=None),
    x_api_key: str | None = Header(default=None, alias="X-API-Key"),
) -> dict:
    """Run one scheduler step: crawl the next queued source, else do maintenance."""
    _authorize(authorization, x_api_key)
    report = tick()
    logger.info("Cron tick: %s in %ss", report.get("action"), report.get("elapsed_seconds"))
    return report
