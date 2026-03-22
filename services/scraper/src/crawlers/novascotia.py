"""Nova Scotia Procurement Portal crawler.

Scrapes https://procurement-portal.novascotia.ca/tenders for provincial
and municipal procurement opportunities across Nova Scotia.

The portal uses F5/Shape Security bot protection that blocks plain HTTP
requests.  This crawler uses cloudscraper to handle the JavaScript
challenge transparently.  Data lives in two places:

  1. **Listing page** — rendered via client-side JS.  We attempt to
     extract tender IDs from the HTML table if the JS challenge is solved.
  2. **Detail pages** (`/tenders/{id}`) — fully server-rendered and
     contain all structured fields we need.

Pagination on the listing page is handled via a `page` query param.
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

_BASE_URL = "https://procurement-portal.novascotia.ca"
_TENDERS_URL = f"{_BASE_URL}/tenders"

_DATE_PATTERNS = [
    re.compile(r"(\d{1,2}\s+\w{3}\s+\d{4})"),           # 26 Jul 2022
    re.compile(r"(\w{3}\s+\d{1,2},?\s+\d{4})"),          # Jul 26, 2022
    re.compile(r"(\d{4}-\d{2}-\d{2})"),                   # 2022-07-26
    re.compile(r"(\d{1,2}\s+\w+\s+\d{4})"),              # 26 July 2022
]

_STATUS_MAP = {
    "open": OpportunityStatus.OPEN,
    "closed": OpportunityStatus.CLOSED,
    "awarded": OpportunityStatus.AWARDED,
    "cancelled": OpportunityStatus.CANCELLED,
}


def _parse_ns_date(raw: str) -> datetime | None:
    """Parse various date formats found on the NS portal."""
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
            "%Y-%m-%d", "%d %B %Y",
        ):
            try:
                return datetime.strptime(text, fmt).replace(tzinfo=timezone.utc)
            except ValueError:
                continue
    return None


def _clean(text: str) -> str:
    return " ".join(text.split()).strip()


def _extract_text(tag: Tag | None) -> str:
    if tag is None:
        return ""
    return _clean(tag.get_text())


class NovaScotiaCrawler(BaseCrawler):
    """Crawl the Nova Scotia Procurement Portal for open tenders."""

    def __init__(self, source_config, session) -> None:
        super().__init__(source_config, session)
        self._cs = cloudscraper.create_scraper(
            browser={"browser": "chrome", "platform": "darwin"},
        )
        self._cs.headers.update({
            "Accept-Language": "en-US,en;q=0.9",
        })

    # ── Main entry point ──────────────────────────────────────

    def crawl(self) -> list[OpportunityCreate]:
        cfg = self.source_config.crawl_config
        max_pages = cfg.get("max_pages", 20)
        page_size = cfg.get("page_size", 50)
        fetch_detail = cfg.get("fetch_detail", True)

        tender_rows = self._fetch_listing(max_pages, page_size)
        self.logger.info("Listing phase: found %d tender rows", len(tender_rows))

        opportunities: list[OpportunityCreate] = []

        for row in tender_rows:
            tender_id = row.get("tender_id", "")
            if not tender_id:
                continue

            if fetch_detail:
                opp = self._fetch_and_parse_detail(tender_id, row)
            else:
                opp = self._row_to_opportunity(row)

            if opp:
                opportunities.append(opp)

        self.logger.info(
            "Nova Scotia crawl complete: %d opportunities", len(opportunities)
        )
        return opportunities

    # ── Listing extraction ────────────────────────────────────

    def _fetch_listing(
        self, max_pages: int, page_size: int
    ) -> list[dict[str, str]]:
        """Fetch the listing page(s) and extract tender rows from the HTML table."""
        all_rows: list[dict[str, str]] = []
        seen_ids: set[str] = set()

        for page_num in range(1, max_pages + 1):
            url = f"{_TENDERS_URL}?page={page_num}&per_page={page_size}"
            self.logger.info("Fetching listing page %d: %s", page_num, url)

            html = self._cs_fetch(url)
            if not html:
                self.logger.warning("Empty response for listing page %d", page_num)
                break

            rows = self._parse_listing_table(html)
            if not rows:
                if page_num == 1:
                    self.logger.warning(
                        "No rows found on page 1 — table may be JS-rendered. "
                        "Trying fallback via detail page listing."
                    )
                    rows = self._fallback_listing(max_pages)
                    all_rows.extend(rows)
                break

            new_count = 0
            for r in rows:
                tid = r.get("tender_id", "")
                if tid and tid not in seen_ids:
                    seen_ids.add(tid)
                    all_rows.append(r)
                    new_count += 1

            self.logger.info("Page %d: %d new tenders", page_num, new_count)
            if new_count == 0:
                break

            time.sleep(self._rate_delay())

        return all_rows

    def _parse_listing_table(self, html: str) -> list[dict[str, str]]:
        """Parse the tender table from listing HTML.

        Columns: Tender ID | Solicitation Type | Title | Organization |
                 Posted Date | Closing Date | Status
        """
        soup = BeautifulSoup(html, "lxml")

        rows: list[dict[str, str]] = []
        for table in soup.find_all("table"):
            header_cells = [
                _clean(th.get_text()).lower()
                for th in table.find_all("th")
            ]
            if "tender id" not in " ".join(header_cells):
                continue

            for tr in table.find_all("tr"):
                tds = tr.find_all("td")
                if len(tds) < 7:
                    continue

                link_tag = tds[0].find("a", href=True)
                tender_id = _clean(tds[0].get_text())
                tender_url = ""
                if link_tag:
                    tender_url = link_tag["href"]
                    if not tender_url.startswith("http"):
                        tender_url = urljoin(_BASE_URL, tender_url)
                    if not tender_id:
                        tender_id = tender_url.rstrip("/").rsplit("/", 1)[-1]

                status_raw = _clean(tds[6].get_text()).lower()
                if status_raw not in ("open",):
                    continue

                rows.append({
                    "tender_id": tender_id,
                    "solicitation_type": _clean(tds[1].get_text()),
                    "title": _clean(tds[2].get_text()),
                    "organization": _clean(tds[3].get_text()),
                    "posted_date": _clean(tds[4].get_text()),
                    "closing_date": _clean(tds[5].get_text()),
                    "status": status_raw,
                    "source_url": tender_url or f"{_TENDERS_URL}/{tender_id}",
                })

        return rows

    def _fallback_listing(self, max_pages: int) -> list[dict[str, str]]:
        """Fallback: fetch a known recent detail page which server-renders
        the listing table at the bottom of the page."""
        self.logger.info("Attempting fallback listing via detail page")

        seed_url = _TENDERS_URL
        html = self._cs_fetch(seed_url)
        if not html:
            return []

        soup = BeautifulSoup(html, "lxml")
        links = soup.find_all("a", href=re.compile(r"/tenders/[A-Z0-9]"))
        if not links:
            self.logger.warning("Fallback: no tender links found on page")
            return []

        rows: list[dict[str, str]] = []
        seen: set[str] = set()

        for a_tag in links:
            href = a_tag.get("href", "")
            tender_id = href.rstrip("/").rsplit("/", 1)[-1]
            if not tender_id or tender_id in seen:
                continue
            seen.add(tender_id)
            rows.append({
                "tender_id": tender_id,
                "title": _clean(a_tag.get_text()) or tender_id,
                "source_url": urljoin(_BASE_URL, href),
                "status": "open",
                "solicitation_type": "",
                "organization": "",
                "posted_date": "",
                "closing_date": "",
            })

        self.logger.info("Fallback found %d tender links", len(rows))
        return rows

    # ── Detail page parsing ───────────────────────────────────

    def _fetch_and_parse_detail(
        self, tender_id: str, listing_row: dict[str, str]
    ) -> OpportunityCreate | None:
        """Fetch and parse a tender detail page."""
        url = f"{_TENDERS_URL}/{tender_id}"
        self.logger.debug("Fetching detail: %s", url)

        html = self._cs_fetch(url)
        if not html:
            self.logger.warning("Failed to fetch detail for %s", tender_id)
            return self._row_to_opportunity(listing_row)

        time.sleep(self._rate_delay())
        return self._parse_detail_page(html, tender_id, listing_row)

    def _parse_detail_page(
        self,
        html: str,
        tender_id: str,
        listing_row: dict[str, str],
    ) -> OpportunityCreate | None:
        """Extract all structured fields from a detail page."""
        soup = BeautifulSoup(html, "lxml")

        fields = self._extract_detail_fields(soup)
        if not fields:
            return self._row_to_opportunity(listing_row)

        title = fields.get("tender title", listing_row.get("title", tender_id))
        if not title:
            return None

        description = fields.get("description", "")

        closing_raw = fields.get("closing date & time (atlantic time)", "")
        closing_date = _parse_ns_date(closing_raw)

        posted_raw = listing_row.get("posted_date", "")
        posted_date = _parse_ns_date(posted_raw)

        org_name = fields.get("procurement entity", listing_row.get("organization"))

        contact_name = fields.get("contact name")
        contact_info = fields.get("contact info", "")
        contact_email = None
        contact_phone = None

        email_match = re.search(r"[\w.+-]+@[\w-]+\.[\w.-]+", contact_info)
        if email_match:
            contact_email = email_match.group(0)

        phone_match = re.search(r"[\d()+\- ]{7,}", contact_info)
        if phone_match and not email_match:
            contact_phone = phone_match.group(0).strip()

        category_raw = fields.get("category:", fields.get("commodity level 1", ""))
        solicitation_type = (
            listing_row.get("solicitation_type")
            or fields.get("solicitation type", "")
        )

        status_raw = listing_row.get("status", "open")
        for key in fields:
            if "status" in key.lower():
                val = fields[key].lower()
                if val in _STATUS_MAP:
                    status_raw = val
                    break

        status = _STATUS_MAP.get(status_raw, OpportunityStatus.OPEN)

        documents = self._extract_documents(soup, tender_id)

        source_url = f"{_TENDERS_URL}/{tender_id}"

        award_details = self._extract_award_details(soup)

        raw_data: dict[str, Any] = {
            "parser_version": "novascotia_v1",
            "tender_id": tender_id,
            "solicitation_type": solicitation_type,
            "closing_location": fields.get("closing location"),
            "commodity_levels": {
                "level_1": fields.get("commodity level 1"),
                "level_2": fields.get("commodity level 2"),
                "level_3": fields.get("commodity level 3"),
                "level_4": fields.get("commodity level 4"),
            },
            "estimated_duration": fields.get(
                "estimated duration of contract (months)"
            ),
            "public_opening": fields.get("public opening location"),
            "submission_language": fields.get("submission language"),
            "trade_agreement": fields.get("trade agreement"),
            "procurement_method": fields.get("procurement method"),
            "memorandum": fields.get("memorandum"),
            "addendum": fields.get("addendum documents / notes"),
            "award_details": award_details,
            "resource_links": documents,
            "all_fields": fields,
            "fetch_timestamp": datetime.now(timezone.utc).isoformat(),
        }

        summary_parts = []
        if solicitation_type:
            summary_parts.append(f"Type: {solicitation_type}")
        if category_raw and category_raw != "–":
            summary_parts.append(f"Category: {category_raw}")
        if description:
            summary_parts.append(description[:300])

        return OpportunityCreate(
            source_id=self.source_config.id,
            external_id=tender_id,
            title=title[:250],
            description_summary=(
                ". ".join(summary_parts)[:500] if summary_parts else None
            ),
            description_full=description[:15000] if description else None,
            status=status,
            country="CA",
            region="NS",
            city=None,
            location_raw="Nova Scotia, Canada",
            posted_date=posted_date.date() if posted_date else None,
            closing_date=closing_date,
            project_type=solicitation_type[:250] if solicitation_type else None,
            category=category_raw[:250] if category_raw else "Procurement",
            solicitation_number=tender_id[:250],
            currency="CAD",
            contact_name=contact_name[:200] if contact_name else None,
            contact_email=contact_email,
            contact_phone=contact_phone,
            source_url=source_url,
            has_documents=len(documents) > 0,
            organization_name=org_name[:200] if org_name else None,
            raw_data=raw_data,
            fingerprint="",
        )

    def _extract_detail_fields(self, soup: BeautifulSoup) -> dict[str, str]:
        """Extract key-value pairs from the detail page.

        The NS portal uses h4 headings as labels with the value in the
        following sibling element.
        """
        fields: dict[str, str] = {}

        for h4 in soup.find_all("h4"):
            label = _clean(h4.get_text()).lower().rstrip(":")
            if not label:
                continue

            value_parts: list[str] = []
            for sibling in h4.next_siblings:
                if isinstance(sibling, Tag):
                    if sibling.name in ("h4", "h3", "h2", "h1", "hr"):
                        break
                    if sibling.name == "table":
                        break
                    value_parts.append(_clean(sibling.get_text()))
                elif isinstance(sibling, str):
                    t = sibling.strip()
                    if t:
                        value_parts.append(t)

            value = " ".join(value_parts).strip()
            if value and value != "–":
                fields[label] = value

        return fields

    def _extract_documents(
        self, soup: BeautifulSoup, tender_id: str
    ) -> list[dict[str, Any]]:
        """Extract document links (tender docs + addenda) from the page."""
        docs: list[dict[str, Any]] = []
        seen_urls: set[str] = set()

        for a_tag in soup.find_all("a", href=True):
            href = a_tag["href"]
            lower_href = href.lower()

            is_doc = any(
                ext in lower_href
                for ext in (".pdf", ".zip", ".doc", ".docx", ".xls", ".xlsx", ".csv")
            )
            if not is_doc:
                continue

            url = href if href.startswith("http") else urljoin(_BASE_URL, href)
            if url in seen_urls:
                continue
            seen_urls.add(url)

            title = _clean(a_tag.get_text()) or url.rsplit("/", 1)[-1]

            file_type = ""
            for ext in (".pdf", ".zip", ".docx", ".doc", ".xlsx", ".xls", ".csv"):
                if ext in lower_href:
                    file_type = ext.lstrip(".")
                    break

            docs.append({
                "title": title[:250],
                "url": url,
                "file_type": file_type or "file",
            })

        return docs

    def _extract_award_details(self, soup: BeautifulSoup) -> list[dict[str, str]]:
        """Parse the award details table if present."""
        awards: list[dict[str, str]] = []

        for table in soup.find_all("table"):
            headers = [
                _clean(th.get_text()).lower() for th in table.find_all("th")
            ]
            if "supplier" not in " ".join(headers):
                continue

            for tr in table.find_all("tr"):
                tds = tr.find_all("td")
                if len(tds) < 4:
                    continue
                awards.append({
                    "supplier": _clean(tds[0].get_text()),
                    "location": _clean(tds[1].get_text()) if len(tds) > 1 else "",
                    "amount": _clean(tds[2].get_text()) if len(tds) > 2 else "",
                    "currency": _clean(tds[3].get_text()) if len(tds) > 3 else "",
                    "award_date": (
                        _clean(tds[4].get_text()) if len(tds) > 4 else ""
                    ),
                })

        return awards

    # ── Row-only fallback ─────────────────────────────────────

    def _row_to_opportunity(
        self, row: dict[str, str]
    ) -> OpportunityCreate | None:
        """Create an OpportunityCreate from listing-row data only (no detail)."""
        title = row.get("title", "")
        tender_id = row.get("tender_id", "")
        if not title and not tender_id:
            return None

        posted = _parse_ns_date(row.get("posted_date", ""))
        closing = _parse_ns_date(row.get("closing_date", ""))
        status_raw = row.get("status", "open").lower()

        return OpportunityCreate(
            source_id=self.source_config.id,
            external_id=tender_id or None,
            title=(title or tender_id)[:250],
            description_summary=None,
            description_full=None,
            status=_STATUS_MAP.get(status_raw, OpportunityStatus.OPEN),
            country="CA",
            region="NS",
            location_raw="Nova Scotia, Canada",
            posted_date=posted.date() if posted else None,
            closing_date=closing,
            project_type=row.get("solicitation_type", "")[:250] or None,
            category="Procurement",
            solicitation_number=tender_id[:250] if tender_id else None,
            currency="CAD",
            source_url=row.get("source_url", f"{_TENDERS_URL}/{tender_id}"),
            has_documents=False,
            organization_name=row.get("organization") or None,
            raw_data={
                "parser_version": "novascotia_v1_listing_only",
                "tender_id": tender_id,
                "solicitation_type": row.get("solicitation_type"),
                "fetch_timestamp": datetime.now(timezone.utc).isoformat(),
            },
            fingerprint="",
        )

    # ── HTTP helpers ──────────────────────────────────────────

    def _cs_fetch(self, url: str) -> str:
        """Fetch a URL using cloudscraper (handles JS challenges)."""
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

                if "captcha" in resp.text.lower()[:500] and resp.status_code == 200:
                    self.logger.warning(
                        "Received CAPTCHA page for %s — bot protection not bypassed",
                        url,
                    )
                    if attempt < self.MAX_RETRIES:
                        time.sleep(self.RETRY_BACKOFF * attempt * 2)
                        self._cs = cloudscraper.create_scraper(
                            browser={"browser": "chrome", "platform": "darwin"},
                        )
                        continue
                    return ""

                resp.raise_for_status()
                return resp.text

            except Exception as exc:
                self.logger.warning(
                    "Fetch failed for %s (attempt %d/%d): %s",
                    url, attempt, self.MAX_RETRIES, exc,
                )
                if attempt < self.MAX_RETRIES:
                    time.sleep(self.RETRY_BACKOFF * attempt)

        self.logger.error("All retries exhausted for %s", url)
        return ""

    def _rate_delay(self) -> float:
        return self.source_config.crawl_config.get(
            "rate_limit_seconds",
            self.config.DEFAULT_RATE_LIMIT_SECONDS,
        )
