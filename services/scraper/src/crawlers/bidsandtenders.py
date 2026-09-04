"""bids&tenders (bidsandtenders.ca) crawler — per-municipality portals.

The old aggregator JSON API (``bidsandtenders.ic9.esolg.ca/.../bidsSearch.ashx``)
was retired in 2026 and now returns 404. Every buyer runs its own tenant at
``https://{tenant}.bidsandtenders.ca`` with the same ASP.NET module, which
exposes a JSON listing:

    GET  /Module/Tenders/en                       → session cookie, hidden
                                                    ``NodeId`` (tenant GUID) and
                                                    anti-forgery token
    POST /Module/Tenders/en/Tender/Search/{NodeId}?status=Open&limit=100&start=0
         &dir=ASC&from=&to=&sort=DateClosing ASC,Id
                                                  → {"success": true, "data": [...]}

Each row carries Id, Title, Description (HTML), DateClosing/DateAvailable
(``/Date(ms)/``), Documents (count) and Addendums. The detail page is
``/Module/Tenders/en/Tender/Detail/{Id}``.

Tenants are configured in ``crawl_config["tenants"]`` (list of subdomains,
defaults to :data:`DEFAULT_TENANTS`); every open bid on every tenant is
returned and the relevance scorer decides what matters — there is no keyword
search on this platform. Tenants are visited round-robin under the time
budget so a slow run resumes with the next tenant.
"""

from __future__ import annotations

import html as _html
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone

from src.crawlers.base import BaseCrawler
from src.models.opportunity import OpportunityCreate, OpportunityStatus

# Ontario municipalities / regions verified to serve the tenant module (2026-09).
DEFAULT_TENANTS = [
    "london", "mississauga", "brampton", "hamilton", "kitchener", "waterloo",
    "regionofwaterloo", "guelph", "oakville", "burlington", "milton", "halton",
    "markham", "vaughan", "richmondhill", "newmarket", "aurora", "york",
    "oshawa", "whitby", "ajax", "pickering", "durham", "peelregion", "caledon",
    "barrie", "niagarafalls", "stcatharines", "niagararegion", "thunderbay",
    "greatersudbury",
]

_NODE_ID_RE = re.compile(r'id="NodeId"\s+value="([0-9a-fA-F-]{36})"')
# The search POST must carry the anti-forgery token from the #bidDetailAntiForgery form.
_ANTIFORGERY_BLOCK_RE = re.compile(r'id="bidDetailAntiForgery".*?name="__RequestVerificationToken"[^>]*value="([^"]+)"', re.S)
_ANY_TOKEN_RE = re.compile(r'name="__RequestVerificationToken"[^>]*value="([^"]+)"')
_MS_DATE_RE = re.compile(r"/Date\((-?\d+)\)/")
_TAG_RE = re.compile(r"<[^>]+>")
_SOLICITATION_RE = re.compile(r"^\s*([A-Z]{2,6}[- ]?\d{2,4}[- ]\d{1,5}[A-Z]?)\s*[-–:]\s*(.+)$")
_USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)


@dataclass
class _Diagnostics:
    api_calls: int = 0
    api_failures: int = 0
    tenants_visited: int = 0
    tenants_failed: list = field(default_factory=list)
    rows_parsed: int = 0
    rows_skipped_dup: int = 0
    rows_skipped_closed: int = 0
    search_results: list = field(default_factory=list)


class BidsAndTendersCrawler(BaseCrawler):
    """Crawl every configured bidsandtenders.ca tenant's open-bid listing."""

    def crawl(self) -> list[OpportunityCreate]:
        cfg = self.source_config.crawl_config
        tenants = [t for t in (cfg.get("tenants") or DEFAULT_TENANTS) if t]
        page_size = int(cfg.get("page_size", 100))
        max_pages = int(cfg.get("max_pages_per_tenant", 3))

        self._diag = _Diagnostics()
        self._http.headers.update({
            "User-Agent": _USER_AGENT,
            "Accept": "application/json, text/plain, */*",
            "Accept-Language": "en-CA,en;q=0.9",
        })

        seen: set[str] = set()
        all_opps: list[OpportunityCreate] = []

        for tenant in self.iter_keywords(tenants):
            try:
                opps = self._crawl_tenant(tenant, page_size, max_pages, seen)
            except Exception as exc:
                self._diag.tenants_failed.append(tenant)
                self.logger.warning("bids&tenders tenant %s failed: %s", tenant, exc)
                opps = []
            self._diag.tenants_visited += 1
            self._diag.search_results.append((tenant, len(opps)))
            all_opps.extend(opps)

        d = self._diag
        self.logger.info(
            "bids&tenders crawl complete: %d bids from %d tenants (%d failed) | api ok=%d failed=%d | dup=%d closed=%d",
            len(all_opps), d.tenants_visited, len(d.tenants_failed), d.api_calls, d.api_failures,
            d.rows_skipped_dup, d.rows_skipped_closed,
        )
        return all_opps

    # ─── Per-tenant ──────────────────────────────────────────

    def _crawl_tenant(self, tenant: str, page_size: int, max_pages: int, seen: set[str]) -> list[OpportunityCreate]:
        base = f"https://{tenant}.bidsandtenders.ca"
        self.rate_limit()
        resp = self._http.get(f"{base}/Module/Tenders/en", timeout=30, allow_redirects=True)
        resp.raise_for_status()
        m = _NODE_ID_RE.search(resp.text)
        if not m:
            raise RuntimeError("NodeId not found (portal moved or blocked)")
        node_id = m.group(1)
        tm = _ANTIFORGERY_BLOCK_RE.search(resp.text) or _ANY_TOKEN_RE.search(resp.text)
        token = tm.group(1) if tm else ""

        results: list[OpportunityCreate] = []
        for page in range(max_pages):
            if page and self.should_stop():
                break
            self.rate_limit()
            params = {
                "status": "Open",
                "limit": str(page_size),
                "start": str(page * page_size),
                "dir": "ASC",
                "from": "",
                "to": "",
                "sort": "DateClosing ASC,Id",
            }
            r = self._http.post(
                f"{base}/Module/Tenders/en/Tender/Search/{node_id}",
                params=params,
                data={"keywords": "", "__RequestVerificationToken": token},
                headers={"X-Requested-With": "XMLHttpRequest", "Referer": f"{base}/Module/Tenders/en"},
                timeout=30,
            )
            if r.status_code != 200 or "json" not in (r.headers.get("content-type") or ""):
                self._diag.api_failures += 1
                self.logger.warning("tenant %s page %d: HTTP %s (%s)", tenant, page, r.status_code, r.headers.get("content-type"))
                break
            self._diag.api_calls += 1
            payload = r.json()
            rows = payload.get("data") or []
            for row in rows:
                opp = self._parse_row(tenant, base, row, seen)
                if opp:
                    results.append(opp)
            if len(rows) < page_size:
                break
        return results

    def _parse_row(self, tenant: str, base: str, t: dict, seen: set[str]) -> OpportunityCreate | None:
        bid_id = (t.get("Id") or "").strip()
        title = _html.unescape((t.get("Title") or "").strip())
        if not bid_id or not title:
            return None
        external_id = f"{tenant}:{bid_id}"
        if external_id in seen:
            self._diag.rows_skipped_dup += 1
            return None
        seen.add(external_id)

        status_raw = (t.get("Status") or "").strip().lower()
        if status_raw in ("closed", "awarded", "cancelled", "unofficial results", "official results"):
            self._diag.rows_skipped_closed += 1
            return None

        closing = self._ms_date(t.get("DateClosing"))
        posted = self._ms_date(t.get("DateAvailable"))
        description_html = t.get("Description") or ""
        description = _html.unescape(_TAG_RE.sub(" ", description_html))
        description = re.sub(r"\s+", " ", description).strip() or None

        solicitation = None
        m = _SOLICITATION_RE.match(title)
        if m:
            solicitation = m.group(1).strip()

        org_display = _html.unescape((t.get("OrganizationName") or "").strip()) or self._tenant_display_name(tenant)
        docs = int(t.get("Documents") or 0)
        addenda = int(t.get("Addendums") or 0)
        view_url = f"{base}/Module/Tenders/en/Tender/Detail/{bid_id}"

        self._diag.rows_parsed += 1
        return OpportunityCreate(
            source_id=self.source_config.id,
            external_id=external_id,
            title=title,
            description_summary=(description[:500] if description else None),
            description_full=description,
            status=OpportunityStatus.OPEN,
            country="CA",
            region="ON",
            city=self._tenant_display_name(tenant),
            location_raw=org_display,
            posted_date=posted.date() if posted else None,
            closing_date=closing,
            category="Municipal Procurement",
            solicitation_number=solicitation,
            currency="CAD",
            source_url=view_url,
            has_documents=docs > 0,
            addenda_count=addenda,
            organization_name=org_display,
            raw_data={
                "parser_version": "bidsandtenders_v2_tenant",
                "tenant": tenant,
                "bid_id": bid_id,
                "status": t.get("Status"),
                "documents": docs,
                "addendums": addenda,
                "plan_takers": t.get("PlanTakers"),
                "closing_display": t.get("DateClosingDisplay"),
                "time_zone": t.get("TimeZoneLabel"),
                "procurement_type": (solicitation or title).split("-")[0].strip() if solicitation else None,
                "fetch_timestamp": datetime.now(timezone.utc).isoformat(),
            },
            fingerprint="",
        )

    # ─── Helpers ─────────────────────────────────────────────

    @staticmethod
    def _ms_date(raw: str | None) -> datetime | None:
        if not raw:
            return None
        m = _MS_DATE_RE.search(str(raw))
        if not m:
            return None
        try:
            return datetime.fromtimestamp(int(m.group(1)) / 1000, tz=timezone.utc)
        except (ValueError, OverflowError, OSError):
            return None

    @staticmethod
    def _tenant_display_name(tenant: str) -> str:
        special = {
            "regionofwaterloo": "Region of Waterloo", "peelregion": "Peel Region", "york": "York Region",
            "durham": "Durham Region", "halton": "Halton Region", "niagararegion": "Niagara Region",
            "richmondhill": "Richmond Hill", "stcatharines": "St. Catharines", "niagarafalls": "Niagara Falls",
            "thunderbay": "Thunder Bay", "greatersudbury": "Greater Sudbury",
        }
        return special.get(tenant, tenant.capitalize())
