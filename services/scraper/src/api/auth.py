"""Shared authentication dependencies for API endpoints."""

from __future__ import annotations

from fastapi import Header, HTTPException, status

from src.core.config import settings


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
