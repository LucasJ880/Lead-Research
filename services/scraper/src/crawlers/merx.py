"""MERX crawler — Canada's largest electronic tendering service.

End-to-end pipeline:
  source registry → listing page fetch → listing pagination →
  listing item extraction → detail page fetch → detail field extraction →
  normalization → relevance scoring → storage → dashboard

Strategy:
  Multiple targeted searches using industry keywords AND MERX category codes.
  Each search is paginated up to `max_pages_per_search` pages.
  Each listing row links to a detail page; when `fetch_detail` is enabled,
  the detail page is fetched to extract description, organization, contacts,
  solicitation number, and other metadata.

MERX requirements:
  1. Session cookies from a homepage visit (JSESSIONID, AWSALB)
  2. Browser-like User-Agent (bot UAs are rejected with 403)
  3. Listing HTML is server-rendered (not a SPA)

URL structure:
  /public/solicitations/open?keywords={kw}&category={cat}&pageNumber={n}

Category codes of interest:
  10013 = Furniture
  10028 = Textiles and Apparel
  10004 = Construction Services
  10032 = Construction Products
  10054 = Maint, Repair, Modification, Rebuilding & Installation

Detail page DOM pattern:
  <div class="mets-field mets-field-view">
    <span class="mets-field-label">Label</span>
    <div class="mets-field-body">Value</div>
  </div>
"""

from __future__ import annotations

import re
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from urllib.parse import urljoin, quote_plus

from bs4 import BeautifulSoup, Tag

from src.crawlers.base import BaseCrawler
from src.models.opportunity import OpportunityCreate, OpportunityStatus

_BASE_URL = "https://www.merx.com"
_LISTING_URL = f"{_BASE_URL}/public/solicitations/open"
_DATE_RE = re.compile(r"(\d{4}/\d{2}/\d{2})")

_SEARCH_KEYWORDS = [
    "blinds",
    "curtains",
    "shades",
    "drapery",
    "window covering",
    "window treatment",
    "furniture",
    "furnishing",
    "textile",
    "linen",
    "bedding",
    "renovation interior",
    "renovation furnishing",
    "hospital curtain",
    "privacy curtain",
    "cubicle curtain",
    "FF&E",
    "roller shade",
    "motorized shade",
    "fabric",
    "upholstery",
    "flooring",
    "carpet",
    "interior fit-out",
    "tenant improvement",
    "hospital renovation",
    "school renovation",
    "hotel renovation",
]

_CATEGORY_SEARCHES = [
    ("10013", "Furniture"),
    ("10028", "Textiles and Apparel"),
    ("10004", "Construction Services"),
    ("10054", "Maint, Repair, Modification"),
]

_BROAD_KEYWORDS = [
    "renovation",
    "interior",
    "furnishing package",
]

_PROVINCE_MAP = {
    "ONTARIO": "ON", "BRITISH COLUMBIA": "BC", "ALBERTA": "AB",
    "QUEBEC": "QC", "MANITOBA": "MB", "SASKATCHEWAN": "SK",
    "NOVA SCOTIA": "NS", "NEW BRUNSWICK": "NB",
    "NEWFOUNDLAND": "NL", "PRINCE EDWARD": "PE",
    "NORTHWEST TERRITORIES": "NT", "NUNAVUT": "NU", "YUKON": "YT",
    ", ON,": "ON", ", BC,": "BC", ", AB,": "AB", ", QC,": "QC",
    ", MB,": "MB", ", SK,": "SK", ", NS,": "NS", ", NB,": "NB",
    ", NL,": "NL", ", PE,": "PE", ", NT,": "NT", ", NU,": "NU",
    ", YT,": "YT",
}


@dataclass
class _CrawlDiagnostics:
    """Tracks detailed crawl statistics for MERX."""
    listing_pages_fetched: int = 0
    listing_pages_failed: int = 0
    detail_pages_fetched: int = 0
    detail_pages_failed: int = 0
    rows_parsed: int = 0
    rows_skipped_no_title: int = 0
    rows_skipped_duplicate: int = 0
    rows_parse_errors: int = 0
    pagination_stops: list = field(default_factory=list)
    search_results: list = field(default_factory=list)


def _parse_date(raw: str) -> datetime | None:
    m = _DATE_RE.search(raw.strip())
    if not m:
        return None
    try:
        dt = datetime.strptime(m.group(1), "%Y/%m/%d")
        return dt.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def _clean(text: str) -> str:
    return " ".join(text.split()).strip()


def _extract_region(location_raw: str) -> str | None:
    location = location_raw.upper()
    for pattern, code in _PROVINCE_MAP.items():
        if pattern in location:
            return code
    return None


class MerxCrawler(BaseCrawler):
    """Crawl MERX using targeted keyword and category searches.

    Supports the full intelligence pipeline:
    listing fetch → pagination → row extraction → detail fetch → field extraction.
    """

    def crawl(self) -> list[OpportunityCreate]:
        cfg = self.source_config.crawl_config
        max_pages = cfg.get("max_pages_per_search", 5)
        fetch_detail = cfg.get("fetch_detail", True)
        include_broad = cfg.get("include_broad_keywords", True)

        self._diag = _CrawlDiagnostics()
        self._init_session()

        seen_urls: set[str] = set()
        all_opps: list[OpportunityCreate] = []

        keywords = list(_SEARCH_KEYWORDS)
        if include_broad:
            keywords.extend(_BROAD_KEYWORDS)

        for kw in keywords:
            opps = self._search_keyword(kw, max_pages, fetch_detail, seen_urls)
            all_opps.extend(opps)
            self._diag.search_results.append(("kw", kw, len(opps)))

        for cat_code, cat_name in _CATEGORY_SEARCHES:
            opps = self._search_category(cat_code, cat_name, max_pages, fetch_detail, seen_urls)
            all_opps.extend(opps)
            self._diag.search_results.append(("cat", cat_name, len(opps)))

        d = self._diag
        self.logger.info(
            "MERX crawl complete: %d unique opps | "
            "listing pages: %d fetched, %d failed | "
            "detail pages: %d fetched, %d failed | "
            "rows: %d parsed, %d no-title, %d dup, %d errors",
            len(all_opps),
            d.listing_pages_fetched, d.listing_pages_failed,
            d.detail_pages_fetched, d.detail_pages_failed,
            d.rows_parsed, d.rows_skipped_no_title,
            d.rows_skipped_duplicate, d.rows_parse_errors,
        )
        for kind, name, count in d.search_results:
            self.logger.info("  %s %-30s → %d opps", kind, name, count)
        for reason in d.pagination_stops:
            self.logger.debug("  pagination stop: %s", reason)

        return all_opps

    # ─── Session ─────────────────────────────────────────────

    def _init_session(self) -> None:
        self._http.headers.update({
            "User-Agent": (
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/120.0.0.0 Safari/537.36"
            ),
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-CA,en-US;q=0.9,en;q=0.8",
        })
        self.logger.info("Establishing MERX session via homepage")
        try:
            self._http.get(_BASE_URL, timeout=15)
            cookies = list(self._http.cookies.keys())
            self.logger.info("Session established, cookies: %s", cookies)
        except Exception as exc:
            self.logger.warning("Homepage visit failed (%s); continuing", exc)

    # ─── Search strategies ───────────────────────────────────

    def _search_keyword(
        self, keyword: str, max_pages: int, fetch_detail: bool, seen: set[str]
    ) -> list[OpportunityCreate]:
        results: list[OpportunityCreate] = []
        for page in range(1, max_pages + 1):
            url = f"{_LISTING_URL}?keywords={quote_plus(keyword)}&pageNumber={page}"
            opps = self._fetch_listing_page(url, fetch_detail, seen)
            if opps is None:
                self._diag.pagination_stops.append(
                    f"kw={keyword} page={page}: fetch failed or empty"
                )
                break
            results.extend(opps)
            if len(opps) < 5:
                self._diag.pagination_stops.append(
                    f"kw={keyword} page={page}: only {len(opps)} rows (< 5), last page"
                )
                break
        self.logger.info("Keyword '%s': %d new opps across %d pages",
                         keyword, len(results), min(page, max_pages))
        return results

    def _search_category(
        self, cat_code: str, cat_name: str, max_pages: int, fetch_detail: bool, seen: set[str]
    ) -> list[OpportunityCreate]:
        results: list[OpportunityCreate] = []
        for page in range(1, max_pages + 1):
            url = f"{_LISTING_URL}?category={cat_code}&pageNumber={page}"
            opps = self._fetch_listing_page(url, fetch_detail, seen)
            if opps is None:
                self._diag.pagination_stops.append(
                    f"cat={cat_name} page={page}: fetch failed or empty"
                )
                break
            results.extend(opps)
            if len(opps) < 5:
                self._diag.pagination_stops.append(
                    f"cat={cat_name} page={page}: only {len(opps)} rows, last page"
                )
                break
        self.logger.info("Category '%s' (%s): %d new opps across %d pages",
                         cat_name, cat_code, len(results), min(page, max_pages))
        return results

    # ─── Listing page ────────────────────────────────────────

    def _fetch_listing_page(
        self, url: str, fetch_detail: bool, seen: set[str]
    ) -> list[OpportunityCreate] | None:
        try:
            html = self.fetch_page(url)
        except Exception as exc:
            self.logger.warning("Listing fetch failed %s: %s", url, exc)
            self._diag.listing_pages_failed += 1
            return None
        if not html:
            self._diag.listing_pages_failed += 1
            return None

        self._diag.listing_pages_fetched += 1
        soup = BeautifulSoup(html, "lxml")
        rows = soup.find_all("tr", class_="mets-table-row")
        if not rows:
            return None

        results: list[OpportunityCreate] = []
        for row in rows:
            try:
                opp = self._parse_listing_row(row, fetch_detail)
                if opp is None:
                    continue
                if opp.source_url in seen:
                    self._diag.rows_skipped_duplicate += 1
                    continue
                seen.add(opp.source_url)
                self._diag.rows_parsed += 1
                results.append(opp)
            except Exception:
                self.logger.exception("Error parsing MERX listing row")
                self._diag.rows_parse_errors += 1
        return results

    # ─── Listing row parsing ─────────────────────────────────

    def _parse_listing_row(self, row: Tag, fetch_detail: bool) -> OpportunityCreate | None:
        link = row.find("a", href=lambda h: h and "open-bids" in str(h))
        if not link:
            return None

        href = link.get("href", "")
        detail_url = urljoin(_BASE_URL, href.split("?")[0])

        title_el = row.find("span", class_="rowTitle")
        title = _clean(title_el.get_text()) if title_el else ""
        if not title:
            self._diag.rows_skipped_no_title += 1
            return None

        org_el = row.find("span", class_="buyer-name")
        org_name = _clean(org_el.get_text()) if org_el else None

        loc_el = row.find("span", class_="location")
        location_raw = _clean(loc_el.get_text()) if loc_el else ""
        region = _extract_region(location_raw)

        pub_date_el = row.find("span", class_="publicationDate")
        posted_date = None
        if pub_date_el:
            date_val = pub_date_el.find("span", class_="dateValue")
            if date_val:
                posted_date = _parse_date(date_val.get_text())

        close_el = row.find("span", class_="closingDate")
        closing_date = None
        if close_el:
            closing_date = _parse_date(close_el.get_text())

        description = None
        category = None
        contact_name = None
        contact_email = None
        solicitation_num = None
        owner_org = None
        raw_text_snapshot = None

        if fetch_detail and detail_url:
            detail = self._fetch_detail_page(detail_url)
            if detail:
                description = detail.get("description")
                category = detail.get("category") or detail.get("solicitation_type")
                contact_name = detail.get("contact_name")
                contact_email = detail.get("contact_email")
                solicitation_num = detail.get("solicitation_number")
                owner_org = detail.get("owner_organization")
                raw_text_snapshot = detail.get("raw_text_snapshot")
                full_title = detail.get("full_title")
                if full_title and len(full_title) > len(title):
                    title = full_title
                if owner_org and not org_name:
                    org_name = owner_org
                if detail.get("location") and not location_raw:
                    location_raw = detail["location"]
                    region = _extract_region(location_raw)

        if not solicitation_num:
            main_col = row.find("td", class_="mainCol")
            if main_col:
                all_text = main_col.get_text(" ", strip=True)
                parts = all_text.split()
                if parts and parts[-1].isdigit() and len(parts[-1]) >= 8:
                    solicitation_num = parts[-1]

        return OpportunityCreate(
            source_id=self.source_config.id,
            external_id=solicitation_num,
            title=title,
            description_summary=description[:500] if description else None,
            description_full=description,
            status=OpportunityStatus.OPEN,
            country="CA",
            region=region,
            location_raw=location_raw or "Canada",
            posted_date=posted_date.date() if posted_date else None,
            closing_date=closing_date,
            category=category or "Procurement",
            solicitation_number=solicitation_num,
            currency="CAD",
            contact_name=contact_name,
            contact_email=contact_email,
            source_url=detail_url,
            has_documents=True,
            organization_name=org_name,
            raw_data={
                "parser_version": "merx_v3",
                "solicitation_number": solicitation_num,
                "location_raw": location_raw,
                "owner_organization": owner_org,
                "raw_text_snapshot": raw_text_snapshot[:2000] if raw_text_snapshot else None,
                "fetch_timestamp": datetime.now(timezone.utc).isoformat(),
            },
            fingerprint="",
        )

    # ─── Detail page extraction ──────────────────────────────

    def _fetch_detail_page(self, url: str) -> dict | None:
        """Fetch and parse a MERX detail page.

        Extracts structured fields from the mets-field-label / mets-field-body
        DOM pattern used on all MERX solicitation detail pages.
        """
        try:
            html = self.fetch_page(url)
        except Exception as exc:
            self.logger.warning("Detail fetch failed %s: %s", url, exc)
            self._diag.detail_pages_failed += 1
            return None
        if not html:
            self._diag.detail_pages_failed += 1
            return None

        self._diag.detail_pages_fetched += 1
        soup = BeautifulSoup(html, "lxml")
        result: dict = {}

        # ── Extract all label/value pairs ──
        fields: dict[str, str] = {}
        for field_div in soup.find_all("div", class_="mets-field"):
            label_el = field_div.find("span", class_="mets-field-label")
            body_el = field_div.find("div", class_="mets-field-body")
            if label_el and body_el:
                key = _clean(label_el.get_text())
                # Strip amendment prefixes like "A - Latest Amendment"
                key = re.sub(r"[A-Z]\s*-\s*(Latest|Previous)\s+Amendment\s*", "", key).strip()
                val = _clean(body_el.get_text())
                if key and val:
                    fields[key.lower()] = val

        # ── Map fields to result ──
        result["full_title"] = fields.get("title", "")

        # h1 often has richer title including solicitation number prefix
        h1 = soup.find("h1", class_="solicitationName")
        if h1:
            h1_text = _clean(h1.get_text())
            if h1_text and len(h1_text) > len(result.get("full_title", "")):
                result["full_title"] = h1_text

        result["description"] = fields.get("description", "")
        result["solicitation_number"] = fields.get("solicitation number", "")
        result["solicitation_type"] = fields.get("solicitation type", "")
        result["issuing_organization"] = fields.get("issuing organization", "")
        result["owner_organization"] = fields.get("owner organization", "")
        result["location"] = fields.get("location", "")
        result["purchase_type"] = fields.get("purchase type", "")
        result["reference_number"] = fields.get("reference number", "")

        # Category: check commodity/GSIN fields
        for key in ["commodity", "category", "gsin", "unspsc"]:
            if key in fields:
                result["category"] = fields[key]
                break

        # Contact extraction from the Contact Information section
        contact_section = soup.find("h3", string=re.compile(r"Contact\s+Information", re.I))
        if contact_section:
            container = contact_section.find_parent("div", class_="content-block")
            if container:
                contact_fields = {}
                for fd in container.find_all("div", class_="mets-field"):
                    lbl = fd.find("span", class_="mets-field-label")
                    body = fd.find("div", class_="mets-field-body")
                    if lbl and body:
                        k = _clean(lbl.get_text()).lower()
                        v = _clean(body.get_text())
                        contact_fields[k] = v

                result["contact_name"] = contact_fields.get("name", "")
                result["contact_email"] = contact_fields.get("email", "")
                result["contact_phone"] = contact_fields.get("phone", "")

        # Fallback email from mailto link
        if not result.get("contact_email"):
            email_link = soup.find("a", href=re.compile(r"^mailto:"))
            if email_link:
                result["contact_email"] = email_link.get_text(strip=True)

        # Closing date from fields (backup if listing didn't have it)
        closing_raw = fields.get("closing date", "")
        if closing_raw:
            result["closing_date"] = closing_raw

        # Raw text snapshot: full text of the main content area
        main = soup.find("main", id="content")
        if main:
            result["raw_text_snapshot"] = _clean(main.get_text())

        # Filter empty strings
        return {k: v for k, v in result.items() if v}
