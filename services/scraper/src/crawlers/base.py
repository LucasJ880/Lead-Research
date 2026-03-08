"""Abstract base crawler with HTTP fetching, rate limiting, and robots.txt support."""

from __future__ import annotations

import time
from abc import ABC, abstractmethod
from urllib.parse import urlparse

import requests
from robotexclusionrulesparser import RobotExclusionRulesParser
from sqlalchemy.orm import Session

from src.core.config import settings
from src.core.logging import get_logger
from src.models.opportunity import OpportunityCreate, SourceConfig


class BaseCrawler(ABC):
    """Base class that every crawler must extend.

    Provides HTTP fetching with retry logic, rate-limiting, robots.txt
    compliance, and logging.
    """

    MAX_RETRIES = 3
    RETRY_BACKOFF = 2  # seconds, doubled each attempt

    def __init__(self, source_config: SourceConfig, session: Session) -> None:
        self._source_config = source_config
        self._session = session
        self._logger = get_logger(f"{__name__}.{self.__class__.__name__}")
        self._robots_cache: dict[str, RobotExclusionRulesParser] = {}
        self._http = requests.Session()
        self._http.headers.update({"User-Agent": self.config.DEFAULT_USER_AGENT})

    # ─── Properties ─────────────────────────────────────────

    @property
    def logger(self) -> "get_logger":
        return self._logger

    @property
    def config(self) -> "settings.__class__":
        return settings

    @property
    def source_config(self) -> SourceConfig:
        return self._source_config

    @property
    def db_session(self) -> Session:
        return self._session

    # ─── Abstract ───────────────────────────────────────────

    @abstractmethod
    def crawl(self) -> list[OpportunityCreate]:
        """Execute the crawl and return parsed opportunities."""
        ...

    # ─── HTTP ───────────────────────────────────────────────

    def fetch_page(self, url: str) -> str:
        """Fetch a URL with retries, rate limiting, and robots.txt checking.

        Args:
            url: The page URL to fetch.

        Returns:
            The response body as a string.

        Raises:
            requests.HTTPError: After all retries are exhausted.
        """
        if settings.RESPECT_ROBOTS_TXT and not self.check_robots_txt(url):
            self.logger.warning("Blocked by robots.txt: %s", url)
            return ""

        self.rate_limit()

        last_exc: Exception | None = None
        for attempt in range(1, self.MAX_RETRIES + 1):
            try:
                self.logger.debug("Fetching %s (attempt %d/%d)", url, attempt, self.MAX_RETRIES)
                resp = self._http.get(url, timeout=30)
                resp.raise_for_status()
                return resp.text
            except requests.RequestException as exc:
                last_exc = exc
                self.logger.warning(
                    "Fetch failed for %s (attempt %d/%d): %s",
                    url,
                    attempt,
                    self.MAX_RETRIES,
                    exc,
                )
                if attempt < self.MAX_RETRIES:
                    time.sleep(self.RETRY_BACKOFF * attempt)

        self.logger.error("All retries exhausted for %s", url)
        raise last_exc  # type: ignore[misc]

    # ─── Robots.txt ─────────────────────────────────────────

    def check_robots_txt(self, url: str) -> bool:
        """Return True if the user-agent is allowed to fetch *url*.

        Results are cached per origin for the lifetime of the crawler.
        """
        parsed = urlparse(url)
        origin = f"{parsed.scheme}://{parsed.netloc}"

        if origin not in self._robots_cache:
            robots_url = f"{origin}/robots.txt"
            parser = RobotExclusionRulesParser()
            try:
                resp = self._http.get(robots_url, timeout=10)
                if resp.status_code == 200:
                    parser.parse(resp.text)
                else:
                    # No robots.txt → everything allowed
                    parser.parse("")
            except requests.RequestException:
                parser.parse("")
            self._robots_cache[origin] = parser

        return self._robots_cache[origin].is_allowed(
            settings.DEFAULT_USER_AGENT, url
        )

    # ─── Rate Limiting ──────────────────────────────────────

    def rate_limit(self) -> None:
        """Sleep for the configured rate-limit delay."""
        delay = self._source_config.crawl_config.get(
            "rate_limit_seconds",
            settings.DEFAULT_RATE_LIMIT_SECONDS,
        )
        if delay > 0:
            time.sleep(delay)
