"""Alberta Purchasing Connection (purchasing.alberta.ca) crawler.

APC is an Angular app backed by a public JSON search API:

    POST https://purchasing.alberta.ca/api/opportunity/search
    {"query": "", "queryMode": "standard", "includeEnhancedMatchIds": false,
     "filter": {... statuses: [{"value": "OPEN", "selected": true, "count": 0}],
                postDateRange: "$$custom", closeDateRange: "$$custom" ...},
     "limit": 100, "offset": <page index>, "sortOptions": []}

The response carries ``values`` (rich posting records incl. UNSPSC commodity
codes, project description, contracting organization, close date) and
``totalCount``. ``offset`` is a page index, not a row offset. No login needed.
Pages are visited round-robin under the time budget (``keyword_cursor``).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone

from src.crawlers.base import BaseCrawler
from src.models.opportunity import OpportunityCreate, OpportunityStatus

_BASE = "https://purchasing.alberta.ca"
_SEARCH_URL = f"{_BASE}/api/opportunity/search"


@dataclass
class _Diagnostics:
    api_calls: int = 0
    api_failures: int = 0
    total_count: int = 0
    rows_parsed: int = 0
    rows_skipped: int = 0
    search_results: list = field(default_factory=list)


def _filter(status: str = "OPEN") -> dict:
    return {
        "solicitationNumber": "",
        "categories": [],
        "statuses": [{"value": status, "selected": True, "count": 0}],
        "agreementTypes": [],
        "solicitationTypes": [],
        "opportunityTypes": [],
        "deliveryRegions": [],
        "deliveryRegion": "",
        "organizations": [],
        "unspsc": [],
        "onlyBookmarked": False,
        "onlyInterestExpressed": False,
        "postDateRange": "$$custom",
        "closeDateRange": "$$custom",
    }


def _parse_dt(raw: str | None) -> datetime | None:
    if not raw:
        return None
    try:
        dt = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
    except ValueError:
        return None
    if dt.tzinfo is None:
        # APC times are Alberta local (Mountain); MDT = UTC-6 most of the year
        from datetime import timedelta

        dt = dt.replace(tzinfo=timezone(timedelta(hours=-6)))
    return dt.astimezone(timezone.utc)


class AlbertaApcCrawler(BaseCrawler):
    """Crawl all OPEN postings from Alberta Purchasing Connection."""

    def crawl(self) -> list[OpportunityCreate]:
        cfg = self.source_config.crawl_config
        page_size = int(cfg.get("page_size", 100))
        max_pages = int(cfg.get("max_pages", 25))
        self._diag = _Diagnostics()
        self._http.headers.update({
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "application/json",
            "Content-Type": "application/json",
            "Origin": _BASE,
            "Referer": f"{_BASE}/search",
        })

        first = self._search(0, page_size)
        if first is None:
            return []
        total = int(first.get("totalCount") or 0)
        self._diag.total_count = total
        pages = min(max_pages, max(1, (total + page_size - 1) // page_size))

        seen: set[str] = set()
        results: list[OpportunityCreate] = []
        results.extend(self._parse_values(first.get("values") or [], seen))
        self._diag.search_results.append(("page0", len(results)))

        for page in self.iter_keywords([str(i) for i in range(1, pages)]):
            data = self._search(int(page), page_size)
            items = self._parse_values((data or {}).get("values") or [], seen)
            results.extend(items)
            self._diag.search_results.append((f"page{page}", len(items)))

        self.logger.info("APC crawl complete: %d open postings (site total %d)", len(results), total)
        return results

    def _search(self, page: int, page_size: int) -> dict | None:
        self.rate_limit()
        body = {
            "query": "",
            "queryMode": "standard",
            "includeEnhancedMatchIds": False,
            "filter": _filter("OPEN"),
            "limit": page_size,
            "offset": page,
            "sortOptions": [],
        }
        try:
            resp = self._http.post(_SEARCH_URL, json=body, timeout=45)
            if resp.status_code != 200:
                self._diag.api_failures += 1
                self.logger.warning("APC search page %d: HTTP %s %s", page, resp.status_code, resp.text[:200])
                return None
            self._diag.api_calls += 1
            return resp.json()
        except Exception as exc:
            self._diag.api_failures += 1
            self.logger.warning("APC search page %d failed: %s", page, exc)
            return None

    def _parse_values(self, values: list[dict], seen: set[str]) -> list[OpportunityCreate]:
        out: list[OpportunityCreate] = []
        for v in values:
            ref = (v.get("referenceNumber") or "").strip()
            title = (v.get("shortTitle") or v.get("title") or "").strip()
            if not ref or not title or ref in seen:
                self._diag.rows_skipped += 1
                continue
            seen.add(ref)
            status_code = (v.get("statusCode") or "").upper()
            status = OpportunityStatus.OPEN if status_code == "OPEN" else OpportunityStatus.CLOSED if status_code == "CLOSED" else OpportunityStatus.UNKNOWN
            desc = (v.get("projectDescription") or "").strip()
            extra = (v.get("additionalRequirements") or "").strip()
            full = desc + ("\n\n" + extra if extra else "")
            codes = [str(c) for c in (v.get("commodityCodes") or [])]
            code_titles = [str(c) for c in (v.get("commodityCodeTitles") or [])]
            regions = [str(r) for r in (v.get("regionOfDelivery") or [])]
            city = next((r for r in regions if r.lower() != "alberta"), None)
            org = (v.get("contractingOrganization") or "").strip() or None
            posted = _parse_dt(v.get("postDateTime"))
            closing = _parse_dt(v.get("closeDateTime"))
            self._diag.rows_parsed += 1
            out.append(
                OpportunityCreate(
                    source_id=self.source_config.id,
                    external_id=ref,
                    title=title,
                    description_summary=(desc or "; ".join(code_titles))[:500] or None,
                    description_full=(full + ("\n\nUNSPSC: " + "; ".join(code_titles) if code_titles else "")) or None,
                    status=status,
                    country="CA",
                    region="AB",
                    city=city,
                    location_raw=", ".join(regions) or "Alberta, Canada",
                    posted_date=(posted or datetime.now(timezone.utc)).date(),
                    closing_date=closing,
                    project_type=v.get("solicitationTypeCode"),
                    category=v.get("categoryCode") or "Procurement",
                    solicitation_number=(v.get("solicitationNumber") or "").strip() or ref,
                    currency="CAD",
                    source_url=f"{_BASE}/posting/{ref}",
                    has_documents=True,
                    addenda_count=1 if v.get("amended") else 0,
                    organization_name=org,
                    raw_data={
                        "parser_version": "alberta_apc_v1",
                        "reference_number": ref,
                        "apc_id": v.get("id"),
                        "status": status_code,
                        "procurement_type": v.get("solicitationTypeCode"),
                        "opportunity_type": v.get("opportunityTypeCode"),
                        "agreement_type": v.get("agreementTypeCode"),
                        "commodity_codes": codes,
                        "commodity_code_titles": code_titles,
                        "ai_keywords": v.get("aiVersionKeywords") or [],
                        "region_of_delivery": regions,
                        "is_notice": v.get("isNotice"),
                        "external_origin_link": v.get("externalOriginLink"),
                        "fetch_timestamp": datetime.now(timezone.utc).isoformat(),
                    },
                    fingerprint="",
                )
            )
        return out
