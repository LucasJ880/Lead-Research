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

        # Time budget (monotonic timestamp). Set by the pipeline on serverless
        # hosts where an invocation cannot exceed a few minutes. ``None`` means
        # unlimited (Docker / local runs).
        self.deadline: float | None = None
        self.deadline_hit: bool = False
        # Position in the keyword list to resume from on the next run. Only
        # meaningful for crawlers that use ``iter_keywords``.
        self.next_keyword_cursor: int | None = None
        self.keywords_completed: bool = True

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

    # ─── Diagnostics ────────────────────────────────────────

    def diagnostics(self) -> dict:
        """Counters recorded on the source_run (override or set ``self._diag``).

        Crawlers that keep a dataclass in ``self._diag`` get it serialized
        automatically; ``search_results`` lists of (keyword, count) become a
        ``zero_yield_searches`` ratio so a silently broken parser is visible.
        """
        diag = getattr(self, "_diag", None)
        if diag is None:
            return {}
        try:
            import dataclasses

            data = dataclasses.asdict(diag) if dataclasses.is_dataclass(diag) else dict(vars(diag))
        except Exception:
            return {}
        searches = data.get("search_results")
        if isinstance(searches, list) and searches:
            zero = sum(1 for item in searches if isinstance(item, (list, tuple)) and len(item) == 2 and not item[1])
            data["searches"] = len(searches)
            data["zero_yield_searches"] = zero
            data["search_results"] = [list(item) for item in searches[:60]]
        return data

    # ─── Time Budget ────────────────────────────────────────

    def time_remaining(self) -> float | None:
        """Seconds left before ``deadline`` (``None`` when unlimited)."""
        if self.deadline is None:
            return None
        return max(0.0, self.deadline - time.monotonic())

    def should_stop(self) -> bool:
        """True once the time budget is exhausted. Crawlers check this between units of work."""
        if self.deadline is not None and time.monotonic() >= self.deadline:
            if not self.deadline_hit:
                self.logger.warning("Crawl time budget exhausted; returning partial results")
            self.deadline_hit = True
            return True
        return False

    def iter_keywords(self, keywords: list[str]):
        """Yield search keywords starting from the persisted cursor, honouring the deadline.

        The pipeline stores ``next_keyword_cursor`` in ``sources.crawl_config``
        after each run so a source whose keyword list cannot be finished in one
        invocation continues where it left off next time (round-robin).
        """
        n = len(keywords)
        if n == 0:
            self.next_keyword_cursor = 0
            return
        try:
            start = int(self._source_config.crawl_config.get("keyword_cursor", 0) or 0) % n
        except (TypeError, ValueError):
            start = 0
        done = 0
        for i in range(n):
            if self.should_stop():
                break
            yield keywords[(start + i) % n]
            done += 1
        self.keywords_completed = done == n
        self.next_keyword_cursor = (start + done) % n

    # ─── Rate Limiting ──────────────────────────────────────

    def rate_limit(self) -> None:
        """Sleep for the configured rate-limit delay."""
        delay = self._source_config.crawl_config.get(
            "rate_limit_seconds",
            settings.DEFAULT_RATE_LIMIT_SECONDS,
        )
        if delay > 0:
            time.sleep(delay)
