"""Biddingo crawler — large Canadian e-procurement aggregator.

End-to-end pipeline:
  source registry → JSON API listing → pagination → detail fetch →
  field extraction → normalization → relevance scoring → storage → dashboard

Strategy:
  Biddingo is an Angular SPA backed by a REST API at api.biddingo.com/restapi.
  Public (unauthenticated) endpoints expose bid listings and details as JSON.

  Listing:  POST /bidding/list/noauthorize/{offset}
            Body: {searchString, bidStatus, country, limit, offset}

  Detail:   GET /bidding/noauthorize/{sysId}/{orgId}/{tenderId}
            Returns full bid info including HTML detailPreview, categoryList, etc.

  V2 Alt:   GET /v2/noauthorize/bids?limit=N&offset=N&country=Canada
            (Used as fallback.)

  The crawler performs targeted keyword searches using industry terms and
  aggregates unique results.  Each listing item already contains rich metadata
  (title, org, dates, province, country, tender number, status, categories).
  Detail pages add an HTML description (detailPreview) and extra metadata.
"""

from __future__ import annotations

import re
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone

from bs4 import BeautifulSoup

from src.crawlers.base import BaseCrawler
from src.models.opportunity import OpportunityCreate, OpportunityStatus

_API_BASE = "https://api.biddingo.com/restapi"
_LIST_URL = f"{_API_BASE}/bidding/list/noauthorize"
_DETAIL_URL = f"{_API_BASE}/bidding/noauthorize"

_SEARCH_KEYWORDS = [
    "blinds",
    "window coverings",
    "curtains",
    "drapery",
    "shades",
    "window treatment",
    "roller shade",
    "motorized shade",
    "privacy curtain",
    "cubicle curtain",
    "hospital curtain",
    "FF&E",
    "furnishing",
    "interior fit-out",
    "tenant improvement",
]

_PROVINCE_MAP = {
    "Ontario": "ON",
    "British Columbia": "BC",
    "Alberta": "AB",
    "Quebec": "QC",
    "Manitoba": "MB",
    "Saskatchewan": "SK",
    "Nova Scotia": "NS",
    "New Brunswick": "NB",
    "Newfoundland and Labrador": "NL",
    "Prince Edward Island": "PE",
    "Northwest Territories": "NT",
    "Nunavut": "NU",
    "Yukon": "YT",
}

_STATUS_MAP = {
    "Open for Bidding": OpportunityStatus.OPEN,
    "Open": OpportunityStatus.OPEN,
    "Closed": OpportunityStatus.CLOSED,
    "Awarded": OpportunityStatus.AWARDED,
    "Cancelled": OpportunityStatus.CANCELLED,
}

_DATE_FMTS = [
    "%m/%d/%Y %I:%M:%S %p",
    "%m/%d/%Y %H:%M:%S %p",
    "%Y-%m-%d %H:%M:%S.%f",
    "%m/%d/%Y",
]


def _parse_date(raw: str | None) -> datetime | None:
    if not raw:
        return None
    raw = raw.strip()
    for fmt in _DATE_FMTS:
        try:
            dt = datetime.strptime(raw, fmt)
            return dt.replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    return None


def _html_to_text(html: str) -> str:
    if not html:
        return ""
    soup = BeautifulSoup(html, "lxml")
    return " ".join(soup.get_text(separator=" ", strip=True).split())


@dataclass
class _CrawlDiagnostics:
    """Tracks Biddingo crawl statistics."""

    api_calls: int = 0
    api_failures: int = 0
    detail_fetches: int = 0
    detail_failures: int = 0
    rows_parsed: int = 0
    rows_skipped_no_title: int = 0
    rows_skipped_duplicate: int = 0
    search_results: list = field(default_factory=list)


class BiddingoCrawler(BaseCrawler):
    """Crawl Biddingo using its public REST API with targeted keyword searches.

    Supports listing fetch via JSON API, pagination, and detail fetch for
    HTML descriptions and category metadata.
    """

    def crawl(self) -> list[OpportunityCreate]:
        cfg = self.source_config.crawl_config
        max_pages = cfg.get("max_pages_per_search", 3)
        page_size = cfg.get("page_size", 25)
        fetch_detail = cfg.get("fetch_detail", True)

        self._diag = _CrawlDiagnostics()
        self._init_session()

        seen_ids: set[int] = set()
        all_opps: list[OpportunityCreate] = []

        for kw in _SEARCH_KEYWORDS:
            opps = self._search_keyword(kw, max_pages, page_size, fetch_detail, seen_ids)
            all_opps.extend(opps)
            self._diag.search_results.append((kw, len(opps)))

        if not all_opps:
            self.logger.info("V1 API returned 0 results, trying V2 fallback...")
            all_opps = self._v2_fallback(page_size, max_pages, fetch_detail, seen_ids)

        d = self._diag
        self.logger.info(
            "Biddingo crawl complete: %d unique opps | "
            "API calls: %d ok, %d failed | "
            "detail: %d fetched, %d failed | "
            "rows: %d parsed, %d no-title, %d dup",
            len(all_opps),
            d.api_calls,
            d.api_failures,
            d.detail_fetches,
            d.detail_failures,
            d.rows_parsed,
            d.rows_skipped_no_title,
            d.rows_skipped_duplicate,
        )
        for kw, count in d.search_results:
            self.logger.info("  kw %-30s → %d opps", kw, count)

        return all_opps

    def _v2_fallback(
        self,
        page_size: int,
        max_pages: int,
        fetch_detail: bool,
        seen: set[int],
    ) -> list[OpportunityCreate]:
        """Try the V2 unauthenticated endpoint as fallback."""
        results: list[OpportunityCreate] = []
        v2_base = f"{_API_BASE}/v2/noauthorize/bids"

        for page in range(max_pages):
            offset = page * page_size
            data = self._api_get(f"{v2_base}?limit={page_size}&offset={offset}&country=Canada")
            if data is None:
                break

            items = data if isinstance(data, list) else data.get("bidInfoList", data.get("data", []))
            if not items or not isinstance(items, list):
                break

            for item in items:
                opp = self._parse_bid(item, fetch_detail, seen)
                if opp:
                    results.append(opp)

            if len(items) < page_size:
                break

        self.logger.info("V2 fallback: %d opps", len(results))
        return results

    # ─── Session ──────────────────────────────────────────────

    def _init_session(self) -> None:
        self._http.headers.update(
            {
                "User-Agent": (
                    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/120.0.0.0 Safari/537.36"
                ),
                "Accept": "application/json, text/plain, */*",
                "Content-Type": "application/json",
                "Origin": "https://www.biddingo.com",
                "Referer": "https://www.biddingo.com/search",
            }
        )
        self.logger.info("Biddingo API session initialized")

    # ─── Search ───────────────────────────────────────────────

    def _search_keyword(
        self,
        keyword: str,
        max_pages: int,
        page_size: int,
        fetch_detail: bool,
        seen: set[int],
    ) -> list[OpportunityCreate]:
        results: list[OpportunityCreate] = []

        for page in range(max_pages):
            offset = page * page_size
            body = {
                "searchString": keyword,
                "bidStatus": "Open",
                "country": "Canada",
                "limit": page_size,
                "offset": offset,
            }
            data = self._api_post(f"{_LIST_URL}/{offset}", body)
            if data is None:
                break

            items = data.get("bidInfoList", [])
            if not items:
                break

            for item in items:
                opp = self._parse_bid(item, fetch_detail, seen)
                if opp:
                    results.append(opp)

            if len(items) < page_size:
                break

        self.logger.info(
            "Keyword '%s': %d new opps across %d pages",
            keyword,
            len(results),
            min(page + 1, max_pages),
        )
        return results

    # ─── API helpers ──────────────────────────────────────────

    def _api_post(self, url: str, body: dict) -> dict | None:
        self.rate_limit()
        try:
            resp = self._http.post(url, json=body, timeout=30)
            resp.raise_for_status()
            ct = resp.headers.get("content-type", "")
            if "json" not in ct:
                self.logger.warning("Non-JSON response from %s: %s", url, ct)
                self._diag.api_failures += 1
                return None
            self._diag.api_calls += 1
            return resp.json()
        except Exception as exc:
            self.logger.warning("API POST failed %s: %s", url, exc)
            self._diag.api_failures += 1
            return None

    def _api_get(self, url: str) -> dict | None:
        self.rate_limit()
        try:
            resp = self._http.get(url, timeout=30)
            resp.raise_for_status()
            ct = resp.headers.get("content-type", "")
            if "json" not in ct:
                self._diag.detail_failures += 1
                return None
            self._diag.detail_fetches += 1
            return resp.json()
        except Exception as exc:
            self.logger.warning("API GET failed %s: %s", url, exc)
            self._diag.detail_failures += 1
            return None

    # ─── Bid parsing ──────────────────────────────────────────

    def _parse_bid(
        self,
        item: dict,
        fetch_detail: bool,
        seen: set[int],
    ) -> OpportunityCreate | None:
        tender_id = item.get("biddingoTenderId")
        if tender_id and tender_id in seen:
            self._diag.rows_skipped_duplicate += 1
            return None

        title = (item.get("tenderName") or "").strip()
        if not title:
            self._diag.rows_skipped_no_title += 1
            return None

        if tender_id:
            seen.add(tender_id)

        buyer_sys_id = item.get("buyerSysId", 1)
        buyer_org_id = item.get("buyerOrgId", 0)
        org_name = (item.get("buyerName") or "").strip() or None
        tender_number = item.get("tenderNumber") or None
        province = item.get("province") or ""
        country_raw = item.get("country") or "Canada"
        city = (item.get("city") or "").strip() or None

        country_code = "CA" if "canada" in country_raw.lower() else "US"
        region = _PROVINCE_MAP.get(province) if province else None

        closing_date = _parse_date(item.get("tenderClosingDate"))
        posted_date = _parse_date(item.get("publishedDate"))
        posted_date_val = posted_date.date() if posted_date else None

        raw_status = item.get("bidStatus") or ""
        status = _STATUS_MAP.get(raw_status, OpportunityStatus.UNKNOWN)

        if status in (OpportunityStatus.CLOSED, OpportunityStatus.AWARDED, OpportunityStatus.CANCELLED):
            self._diag.rows_skipped_duplicate += 1
            return None

        if posted_date and posted_date.year < 2025:
            self._diag.rows_skipped_duplicate += 1
            return None

        categories = [
            c.get("categoryName", "")
            for c in (item.get("categoryList") or [])
            if c.get("categoryName")
        ]
        category_str = "; ".join(categories)[:250] if categories else None

        detail_url = (
            f"https://www.biddingo.com/bid/{buyer_sys_id}/{buyer_org_id}/{tender_id}"
            if tender_id
            else "https://www.biddingo.com"
        )

        description = None
        raw_text_snapshot = None

        if fetch_detail and tender_id:
            detail = self._fetch_detail(buyer_sys_id, buyer_org_id, tender_id)
            if detail:
                raw_html = detail.get("detailPreview") or detail.get("detail") or ""
                if raw_html:
                    description = _html_to_text(raw_html)
                    raw_text_snapshot = description[:2000] if description else None

                detail_cats = [
                    c.get("categoryName", "")
                    for c in (detail.get("categoryList") or [])
                    if c.get("categoryName")
                ]
                if detail_cats and not category_str:
                    category_str = "; ".join(detail_cats)[:250]

                if detail.get("buyerName") and not org_name:
                    org_name = detail["buyerName"].strip()

        self._diag.rows_parsed += 1

        return OpportunityCreate(
            source_id=self.source_config.id,
            external_id=str(tender_id) if tender_id else None,
            title=title,
            description_summary=description[:500] if description else None,
            description_full=description,
            status=status,
            country=country_code,
            region=region,
            city=city,
            location_raw=f"{city or ''}, {province}, {country_raw}".strip(", "),
            posted_date=posted_date_val,
            closing_date=closing_date,
            category=category_str or "Procurement",
            solicitation_number=tender_number,
            currency="CAD" if country_code == "CA" else "USD",
            contact_name=None,
            contact_email=None,
            source_url=detail_url,
            has_documents=bool(item.get("documentCount", 0)),
            organization_name=org_name,
            raw_data={
                "parser_version": "biddingo_v1",
                "biddingo_tender_id": tender_id,
                "buyer_sys_id": buyer_sys_id,
                "buyer_org_id": buyer_org_id,
                "tender_number": tender_number,
                "bid_type": item.get("bidType"),
                "value_range": item.get("valueRange"),
                "categories": categories,
                "raw_text_snapshot": raw_text_snapshot,
                "fetch_timestamp": datetime.now(timezone.utc).isoformat(),
            },
            fingerprint="",
        )

    # ─── Detail fetch ─────────────────────────────────────────

    def _fetch_detail(self, sys_id: int, org_id: int, tender_id: int) -> dict | None:
        url = f"{_DETAIL_URL}/{sys_id}/{org_id}/{tender_id}"
        data = self._api_get(url)
        if not data:
            return None
        return data.get("bidInfo") if isinstance(data, dict) else None
