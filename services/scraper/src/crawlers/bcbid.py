"""BC Bid crawler — British Columbia provincial procurement portal.

BC Bid (bcbid.gov.bc.ca) runs on the Jaggaer e-procurement platform and
uses a JavaScript browser-verification challenge before rendering content.
This crawler uses cloudscraper to handle the challenge, then parses the
public opportunities listing at /page.aspx/en/bps/process_browse.

If the JS challenge cannot be bypassed, the crawler gracefully returns an
empty list and logs a warning — no crash, no partial data.
"""

from __future__ import annotations

import re
import time
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urljoin

import cloudscraper
from bs4 import BeautifulSoup, Tag

from src.crawlers.base import BaseCrawler
from src.models.opportunity import OpportunityCreate, OpportunityStatus

_BASE_URL = "https://bcbid.gov.bc.ca"
_BROWSE_URL = f"{_BASE_URL}/page.aspx/en/bps/process_browse"
_CHECK_URL = f"{_BASE_URL}/page.aspx/en/bas/browser_check"

_DATE_PATTERNS = [
    re.compile(r"(\d{1,2}\s+\w{3}\s+\d{4})"),        # 26 Jul 2022
    re.compile(r"(\w{3}\s+\d{1,2},?\s+\d{4})"),       # Jul 26, 2022
    re.compile(r"(\d{4}-\d{2}-\d{2})"),                # 2022-07-26
    re.compile(r"(\d{1,2}/\d{1,2}/\d{4})"),            # 3/26/2022
]

_STATUS_MAP = {
    "open": OpportunityStatus.OPEN,
    "active": OpportunityStatus.OPEN,
    "published": OpportunityStatus.OPEN,
    "closed": OpportunityStatus.CLOSED,
    "awarded": OpportunityStatus.AWARDED,
    "cancelled": OpportunityStatus.CANCELLED,
}


def _parse_date(raw: str) -> datetime | None:
    if not raw:
        return None
    raw = raw.strip()
    for pattern in _DATE_PATTERNS:
        m = pattern.search(raw)
        if not m:
            continue
        text = m.group(1)
        for fmt in (
            "%d %b %Y", "%b %d, %Y", "%b %d %Y",
            "%Y-%m-%d", "%m/%d/%Y",
        ):
            try:
                return datetime.strptime(text, fmt).replace(tzinfo=timezone.utc)
            except ValueError:
                continue
    return None


def _clean(text: str) -> str:
    return " ".join(text.split()).strip()


class BCBidCrawler(BaseCrawler):
    """Crawl BC Bid for provincial procurement opportunities."""

    def __init__(self, source_config, session) -> None:
        super().__init__(source_config, session)
        self._cs = cloudscraper.create_scraper(
            browser={"browser": "chrome", "platform": "darwin"},
        )
        self._cs.headers.update({
            "Accept-Language": "en-US,en;q=0.9",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        })

    def crawl(self) -> list[OpportunityCreate]:
        self.logger.info("Initiating BC Bid crawl via browser-check bypass")

        html = self._navigate_to_listing()
        if not html:
            self.logger.warning(
                "Could not reach BC Bid listing page — "
                "Jaggaer JS challenge may require Playwright"
            )
            return []

        if self._is_blocked(html):
            self.logger.warning(
                "BC Bid returned browser-check / CAPTCHA page — "
                "cloudscraper bypass unsuccessful"
            )
            return []

        opportunities = self._parse_listing(html)
        self.logger.info("Parsed %d opportunities from BC Bid", len(opportunities))
        return opportunities

    def _navigate_to_listing(self) -> str:
        """Navigate through the browser check to the public browse page."""
        check_html = self._cs_fetch(_CHECK_URL)
        if not check_html:
            return ""

        time.sleep(self._rate_delay())

        listing_html = self._cs_fetch(_BROWSE_URL)
        return listing_html

    def _is_blocked(self, html: str) -> bool:
        lower = html[:2000].lower()
        blocked_signals = [
            "browser check",
            "checking your browser",
            "captcha",
            "please wait while we",
            "javascript is required",
        ]
        return any(sig in lower for sig in blocked_signals)

    def _parse_listing(self, html: str) -> list[OpportunityCreate]:
        """Parse the opportunities grid from BC Bid listing HTML."""
        soup = BeautifulSoup(html, "lxml")
        opportunities: list[OpportunityCreate] = []

        for table in soup.find_all("table"):
            headers = [_clean(th.get_text()).lower() for th in table.find_all("th")]
            header_text = " ".join(headers)

            if not any(kw in header_text for kw in ("title", "reference", "opportunity", "solicitation")):
                continue

            col_map = self._build_column_map(headers)
            if not col_map:
                continue

            for tr in table.find_all("tr"):
                tds = tr.find_all("td")
                if len(tds) < 2:
                    continue
                try:
                    opp = self._parse_row(tds, col_map)
                    if opp:
                        opportunities.append(opp)
                except Exception:
                    self.logger.exception("Error parsing BC Bid row")

        if not opportunities:
            opportunities = self._fallback_link_parse(soup)

        return opportunities

    def _build_column_map(self, headers: list[str]) -> dict[str, int]:
        """Map known column names to their index positions."""
        mapping: dict[str, int] = {}
        for idx, h in enumerate(headers):
            if any(kw in h for kw in ("reference", "ref", "id", "number")):
                mapping.setdefault("ref", idx)
            elif any(kw in h for kw in ("title", "description", "name", "opportunity")):
                mapping.setdefault("title", idx)
            elif any(kw in h for kw in ("organization", "ministry", "entity", "owner")):
                mapping.setdefault("org", idx)
            elif "status" in h:
                mapping.setdefault("status", idx)
            elif any(kw in h for kw in ("publish", "posted", "open", "start")):
                mapping.setdefault("posted", idx)
            elif any(kw in h for kw in ("clos", "deadline", "due", "end")):
                mapping.setdefault("closing", idx)
            elif any(kw in h for kw in ("type", "solicitation", "category")):
                mapping.setdefault("type", idx)

        if "title" not in mapping:
            return {}
        return mapping

    def _parse_row(
        self, tds: list[Tag], col_map: dict[str, int]
    ) -> OpportunityCreate | None:
        def cell(key: str) -> str:
            idx = col_map.get(key)
            if idx is not None and idx < len(tds):
                return _clean(tds[idx].get_text())
            return ""

        title = cell("title")
        if not title:
            return None

        ref = cell("ref")
        org = cell("org")
        status_raw = cell("status").lower()
        posted_raw = cell("posted")
        closing_raw = cell("closing")
        proj_type = cell("type")

        status = _STATUS_MAP.get(status_raw, OpportunityStatus.OPEN)
        posted = _parse_date(posted_raw)
        closing = _parse_date(closing_raw)

        title_td_idx = col_map.get("title", 0)
        source_url = _BROWSE_URL
        if title_td_idx < len(tds):
            link = tds[title_td_idx].find("a", href=True)
            if link:
                href = link["href"]
                source_url = href if href.startswith("http") else urljoin(_BASE_URL, href)

        return OpportunityCreate(
            source_id=self.source_config.id,
            external_id=ref or None,
            title=title[:250],
            description_summary=None,
            description_full=None,
            status=status,
            country="CA",
            region="BC",
            location_raw="British Columbia, Canada",
            posted_date=posted.date() if posted else None,
            closing_date=closing,
            project_type=proj_type[:250] if proj_type else None,
            category="Provincial Procurement",
            solicitation_number=ref[:250] if ref else None,
            currency="CAD",
            source_url=source_url,
            has_documents=True,
            organization_name=org[:200] if org else None,
            raw_data={
                "parser_version": "bcbid_v1",
                "reference_number": ref,
                "status_raw": status_raw,
                "posted_raw": posted_raw,
                "closing_raw": closing_raw,
                "fetch_timestamp": datetime.now(timezone.utc).isoformat(),
            },
            fingerprint="",
        )

    def _fallback_link_parse(self, soup: BeautifulSoup) -> list[OpportunityCreate]:
        """Fallback: extract opportunity links when table parsing fails."""
        opportunities: list[OpportunityCreate] = []
        seen: set[str] = set()

        for a_tag in soup.find_all("a", href=True):
            href = a_tag["href"]
            text = _clean(a_tag.get_text())

            is_opp_link = any(
                seg in href.lower()
                for seg in ("/bps/process_manage", "/bpm/process", "/opportunity")
            )
            if not is_opp_link or not text or len(text) < 10:
                continue
            if href in seen:
                continue
            seen.add(href)

            source_url = href if href.startswith("http") else urljoin(_BASE_URL, href)

            opportunities.append(OpportunityCreate(
                source_id=self.source_config.id,
                external_id=None,
                title=text[:250],
                description_summary=None,
                description_full=None,
                status=OpportunityStatus.OPEN,
                country="CA",
                region="BC",
                location_raw="British Columbia, Canada",
                posted_date=None,
                closing_date=None,
                project_type=None,
                category="Provincial Procurement",
                solicitation_number=None,
                currency="CAD",
                source_url=source_url,
                has_documents=True,
                organization_name="Province of British Columbia",
                raw_data={
                    "parser_version": "bcbid_v1_fallback",
                    "fetch_timestamp": datetime.now(timezone.utc).isoformat(),
                },
                fingerprint="",
            ))

        return opportunities

    def _cs_fetch(self, url: str) -> str:
        """Fetch a URL using cloudscraper to handle JS challenges."""
        if self.config.RESPECT_ROBOTS_TXT and not self.check_robots_txt(url):
            self.logger.warning("Blocked by robots.txt: %s", url)
            return ""

        for attempt in range(1, self.MAX_RETRIES + 1):
            try:
                self.logger.debug(
                    "cloudscraper fetch %s (attempt %d/%d)",
                    url, attempt, self.MAX_RETRIES,
                )
                resp = self._cs.get(url, timeout=30)
                resp.raise_for_status()
                return resp.text
            except Exception as exc:
                self.logger.warning(
                    "Fetch failed for %s (attempt %d/%d): %s",
                    url, attempt, self.MAX_RETRIES, exc,
                )
                if attempt < self.MAX_RETRIES:
                    time.sleep(self.RETRY_BACKOFF * attempt)
                    self._cs = cloudscraper.create_scraper(
                        browser={"browser": "chrome", "platform": "darwin"},
                    )

        self.logger.error("All retries exhausted for %s", url)
        return ""

    def _rate_delay(self) -> float:
        return self.source_config.crawl_config.get(
            "rate_limit_seconds",
            self.config.DEFAULT_RATE_LIMIT_SECONDS,
        )
