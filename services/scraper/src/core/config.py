"""Application configuration loaded from environment variables."""

from __future__ import annotations

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

def _find_project_root() -> Path:
    """Walk up from this file to find the project root (.env location)."""
    current = Path(__file__).resolve()
    for parent in current.parents:
        if (parent / ".env").exists():
            return parent
        if parent == parent.parent:
            break
    return Path("/app")

_PROJECT_ROOT = _find_project_root()
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
    AGENT_API_KEY: str = ""

    # MERX authenticated access (never log or expose these)
    MERX_EMAIL: str = ""
    MERX_PASSWORD: str = ""

    # OpenAI for document intelligence
    OPENAI_API_KEY: str = ""

    # Google Translate
    GOOGLE_TRANSLATE_API_KEY: str = ""

    # Qingyan integration (for auto-push from scraper tasks)
    QINGYAN_API_BASE: str = ""
    QINGYAN_API_TOKEN: str = ""
    QINGYAN_ENABLED: str = "false"

    # AI cost control
    AI_DAILY_BUDGET_USD: float = 5.0
    AI_MONTHLY_BUDGET_USD: float = 100.0

    DEFAULT_RATE_LIMIT_SECONDS: int = 3
    DEFAULT_MAX_PAGES_PER_SOURCE: int = 20
    DEFAULT_USER_AGENT: str = (
        "LeadHarvest/1.0 (+https://leadharvest.local/bot; bot@leadharvest.local)"
    )
    RESPECT_ROBOTS_TXT: bool = True

    LOG_LEVEL: str = "info"

    @property
    def merx_credentials_available(self) -> bool:
        return bool(self.MERX_EMAIL and self.MERX_PASSWORD)


settings = Settings()


def validate_startup_config() -> list[str]:
    """Return a list of warnings about missing configuration.

    Called at FastAPI startup to surface misconfigurations early.
    """
    warnings: list[str] = []
    if not settings.SCRAPER_API_KEY:
        warnings.append("SCRAPER_API_KEY is empty — all authenticated endpoints will return 500")
    if not settings.DATABASE_URL or "localhost" in settings.DATABASE_URL:
        warnings.append(f"DATABASE_URL looks like a dev default ({settings.DATABASE_URL[:40]}...)")
    if not settings.merx_credentials_available:
        warnings.append("MERX_EMAIL / MERX_PASSWORD not set — MERX crawling disabled")
    if not settings.OPENAI_API_KEY:
        warnings.append("OPENAI_API_KEY not set — AI analysis will use rule-based fallback")
    return warnings
