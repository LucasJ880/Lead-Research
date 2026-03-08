"""Application configuration loaded from environment variables."""

from __future__ import annotations

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

_PROJECT_ROOT = Path(__file__).resolve().parents[4]
_ENV_FILE = _PROJECT_ROOT / ".env"


class Settings(BaseSettings):
    """Scraper service configuration.

    Values are loaded from environment variables first, falling back
    to the project-root ``.env`` file.
    """

    model_config = SettingsConfigDict(
        env_file=str(_ENV_FILE) if _ENV_FILE.exists() else ".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    DATABASE_URL: str = "postgresql://localhost:5432/leadharvest"
    REDIS_URL: str = "redis://localhost:6379/0"

    SCRAPER_API_KEY: str = ""

    DEFAULT_RATE_LIMIT_SECONDS: int = 3
    DEFAULT_MAX_PAGES_PER_SOURCE: int = 20
    DEFAULT_USER_AGENT: str = (
        "LeadHarvest/1.0 (+https://leadharvest.local/bot; bot@leadharvest.local)"
    )
    RESPECT_ROBOTS_TXT: bool = True

    LOG_LEVEL: str = "info"


settings = Settings()
