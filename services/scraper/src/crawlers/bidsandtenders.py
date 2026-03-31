"""Bids & Tenders crawler — Canadian municipal e-procurement aggregator.

Strategy:
  bidsandtenders.com embeds an iframe from the eSolutions ic9 platform.
  The underlying data is served via a JSON AJAX endpoint at:
    https://bidsandtenders.ic9.esolg.ca/Modules/BidsAndTenders/services/bidsSearch.ashx

  This endpoint accepts GET parameters:
    keywords, statusId (1=Open), pageNum, pageSize, organizationId,
    sortColumn, sortDir, fromDateUtc, toDateUtc

  Response: {"success": true, "data": {"count": N, "totalCount": N, "tenders": [...]}}

  Each tender includes: name, status, utcClosingDate, utcPublishDate,
  organization (name, displayName), viewUrl, registerUrl, bidHasFee, timeZone.

  The crawler uses targeted keyword searches then deduplicates by viewUrl.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from datetime import datetime, timezone

from src.crawlers.base import BaseCrawler
from src.models.opportunity import OpportunityCreate, OpportunityStatus

_API_URLS = [
    "https://bidsandtenders.ic9.esolg.ca/Modules/BidsAndTenders/services/bidsSearch.ashx",
    "https://www.bidsandtenders.ca/Module/Tenders/en/Tender/Search",
]

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
    "standing agreement",
    "window",
    "liner",
    "blanket",
    "textiles",
    "shutters",
    "bedding",
    "towel",
    "bag",
    "sock",
    "mask",
]


@dataclass
class _Diagnostics:
    api_calls: int = 0
    api_failures: int = 0
    rows_parsed: int = 0
    rows_skipped_dup: int = 0
    rows_skipped_closed: int = 0
    search_results: list = field(default_factory=list)


class BidsAndTendersCrawler(BaseCrawler):
    """Crawl bidsandtenders.com via the eSolutions ic9 JSON API."""

    def crawl(self) -> list[OpportunityCreate]:
        cfg = self.source_config.crawl_config
        max_pages = cfg.get("max_pages_per_search", 5)
        page_size = cfg.get("page_size", 50)

        self._diag = _Diagnostics()
        self._http.headers.update({
            "User-Agent": (
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/120.0.0.0 Safari/537.36"
            ),
            "Accept": "application/json, text/plain, */*",
            "X-Requested-With": "XMLHttpRequest",
            "Referer": "https://www.bidsandtenders.com/bid-opportunities/",
        })

        seen_urls: set[str] = set()
        all_opps: list[OpportunityCreate] = []

        for kw in _SEARCH_KEYWORDS:
            opps = self._search_keyword(kw, max_pages, page_size, seen_urls)
            all_opps.extend(opps)
            self._diag.search_results.append((kw, len(opps)))

        d = self._diag
        self.logger.info(
            "BidsAndTenders crawl complete: %d unique opps | "
            "API calls: %d ok, %d failed | "
            "rows: %d parsed, %d dup, %d closed",
            len(all_opps), d.api_calls, d.api_failures,
            d.rows_parsed, d.rows_skipped_dup, d.rows_skipped_closed,
        )
        for kw, count in d.search_results:
            self.logger.info("  kw %-30s → %d opps", kw, count)

        return all_opps

    def _search_keyword(
        self,
        keyword: str,
        max_pages: int,
        page_size: int,
        seen: set[str],
    ) -> list[OpportunityCreate]:
        results: list[OpportunityCreate] = []

        for page_num in range(1, max_pages + 1):
            data = self._api_search(keyword, page_num, page_size)
            if data is None:
                break

            tenders = data.get("tenders", [])
            if not tenders:
                break

            for tender in tenders:
                opp = self._parse_tender(tender, seen)
                if opp:
                    results.append(opp)

            if len(tenders) < page_size:
                break

        return results

    def _api_search(self, keyword: str, page_num: int, page_size: int) -> dict | None:
        cfg_url = self.source_config.crawl_config.get("api_url")
        urls = [cfg_url] if cfg_url else _API_URLS

        for api_url in urls:
            self.rate_limit()
            try:
                resp = self._http.get(
                    api_url,
                    params={
                        "keywords": keyword,
                        "statusId": "1",
                        "pageNum": str(page_num),
                        "pageSize": str(page_size),
                    },
                    timeout=30,
                )
                resp.raise_for_status()

                ct = resp.headers.get("content-type", "")
                if "json" not in ct and "javascript" not in ct:
                    self.logger.warning("Non-JSON response from %s: %s", api_url[:60], ct)
                    continue

                payload = resp.json()
                self._diag.api_calls += 1

                if not payload.get("success") and not payload.get("data"):
                    self.logger.warning("API returned empty for kw=%s from %s", keyword, api_url[:60])
                    continue

                data = payload.get("data", payload)
                if isinstance(data, dict):
                    return data
                return {"tenders": data} if isinstance(data, list) else {}

            except Exception as exc:
                self.logger.warning("API search failed kw=%s at %s: %s", keyword, api_url[:60], exc)

        self._diag.api_failures += 1
        return None

    def _parse_tender(self, t: dict, seen: set[str]) -> OpportunityCreate | None:
        view_url = (t.get("viewUrl") or "").strip()
        if not view_url:
            return None

        if view_url in seen:
            self._diag.rows_skipped_dup += 1
            return None
        seen.add(view_url)

        name = (t.get("name") or "").strip()
        if not name:
            return None

        status_name = (t.get("status", {}).get("name") or "").lower()
        if status_name in ("closed", "awarded", "cancelled"):
            self._diag.rows_skipped_closed += 1
            return None

        org = t.get("organization", {})
        org_display = org.get("displayName") or org.get("name") or ""
        org_short = org.get("name") or ""

        closing_date = self._parse_iso(t.get("utcClosingDate"))
        publish_date = self._parse_iso(t.get("utcPublishDate"))
        posted_date_val = publish_date.date() if publish_date else None

        self._diag.rows_parsed += 1

        return OpportunityCreate(
            source_id=self.source_config.id,
            external_id=view_url,
            title=name,
            description_summary=None,
            description_full=None,
            status=OpportunityStatus.OPEN,
            country="CA",
            region=None,
            city=None,
            location_raw=org_display or None,
            posted_date=posted_date_val,
            closing_date=closing_date,
            category="Procurement",
            solicitation_number=None,
            currency="CAD",
            contact_name=None,
            contact_email=None,
            source_url=view_url,
            has_documents=False,
            organization_name=org_display or None,
            raw_data={
                "parser_version": "bidsandtenders_v1",
                "org_short": org_short,
                "org_display": org_display,
                "register_url": t.get("registerUrl"),
                "bid_has_fee": t.get("bidHasFee"),
                "time_zone": t.get("timeZone"),
                "converted_publish_date": t.get("convertedPublishDate"),
                "converted_closing_date": t.get("convertedClosingDate"),
                "fetch_timestamp": datetime.now(timezone.utc).isoformat(),
            },
            fingerprint="",
        )

    @staticmethod
    def _parse_iso(raw: str | None) -> datetime | None:
        if not raw:
            return None
        try:
            dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt
        except (ValueError, TypeError):
            return None
