"""SaskTenders crawler (www.sasktenders.ca, 2026 site).

The portal was rebuilt in 2026: ``/Search?status=Open&pageNumber=N&pageSize=50``
is a server-rendered table where every competition is a pair of ``<tr>`` rows —
a summary row (name, organization, competition #, open/close date, status) and a
hidden detail row (Synopsis, Additional Information, contact details, links).
No JSON API and no login are required.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from urllib.parse import urljoin

from bs4 import BeautifulSoup

from src.crawlers.base import BaseCrawler
from src.models.opportunity import OpportunityCreate, OpportunityStatus

_BASE_URL = "https://www.sasktenders.ca"
_SEARCH_URL = f"{_BASE_URL}/Search"
_DATE_RE = re.compile(r"([A-Z][a-z]{2} \d{1,2}, \d{4})(?:\s+(\d{1,2}:\d{2} [AP]M))?")
_MONTHS = {m: i for i, m in enumerate(["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"], 1)}


@dataclass
class _Diagnostics:
    pages: int = 0
    rows_parsed: int = 0
    rows_skipped: int = 0
    search_results: list = field(default_factory=list)


class SaskTendersCrawler(BaseCrawler):
    """Crawl open competitions from the SaskTenders search table."""

    def crawl(self) -> list[OpportunityCreate]:
        cfg = self.source_config.crawl_config
        page_size = int(cfg.get("page_size", 50))
        max_pages = int(cfg.get("max_pages", 10))
        self._diag = _Diagnostics()
        self._http.headers.update({
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml",
        })

        results: list[OpportunityCreate] = []
        seen: set[str] = set()
        for page in range(1, max_pages + 1):
            if page > 1 and self.should_stop():
                break
            self.rate_limit()
            resp = self._http.get(
                _SEARCH_URL,
                params={"status": "Open", "pageNumber": page, "pageSize": page_size},
                timeout=45,
            )
            resp.raise_for_status()
            page_items = self._parse_page(resp.text, seen)
            self._diag.pages += 1
            self._diag.search_results.append((f"page{page}", len(page_items)))
            results.extend(page_items)
            if len(page_items) < page_size:
                break

        self.logger.info("SaskTenders crawl complete: %d competitions from %d page(s)", len(results), self._diag.pages)
        return results

    # ─── Parsing ─────────────────────────────────────────────

    def _parse_page(self, html: str, seen: set[str]) -> list[OpportunityCreate]:
        soup = BeautifulSoup(html, "lxml")
        table = soup.find("table")
        if table is None:
            return []
        rows = table.find_all("tr")
        items: list[OpportunityCreate] = []
        i = 0
        while i < len(rows):
            row = rows[i]
            cells = row.find_all("td", recursive=False)
            if len(cells) >= 6:
                detail = None
                if i + 1 < len(rows):
                    nxt = rows[i + 1]
                    if nxt.find("td", attrs={"colspan": True}) is not None:
                        detail = nxt
                        i += 1
                opp = self._build(cells, detail, seen)
                if opp:
                    items.append(opp)
            i += 1
        return items

    def _build(self, cells, detail, seen: set[str]) -> OpportunityCreate | None:
        title = cells[1].get_text(" ", strip=True)
        org = cells[2].get_text(" ", strip=True)
        number = cells[3].get_text(" ", strip=True)
        open_raw = cells[4].get_text(" ", strip=True)
        close_raw = cells[5].get_text(" ", strip=True)
        status_raw = cells[6].get_text(" ", strip=True) if len(cells) > 6 else "Open"
        if not title:
            self._diag.rows_skipped += 1
            return None
        key = number or title
        if key in seen:
            self._diag.rows_skipped += 1
            return None
        seen.add(key)

        synopsis = additional = None
        contact_name = contact_email = contact_phone = None
        source_url = f"{_SEARCH_URL}?status=Open"
        competition_type = None
        if detail is not None:
            synopsis = self._section_text(detail, "Synopsis")
            additional = self._section_text(detail, "Additional Information")
            competition_type = self._section_text(detail, "Competition Type") or self._section_text(detail, "Type")
            mail = detail.find("a", href=re.compile(r"^mailto:", re.I))
            if mail:
                contact_email = mail.get("href", "")[7:].split("?")[0] or None
            text = detail.get_text(" ", strip=True)
            m = re.search(r"Contact:?\s*([A-Z][\w.'-]+(?: [A-Z][\w.'-]+){0,3})", text)
            if m:
                contact_name = m.group(1)
            m = re.search(r"Phone:?\s*(\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4})", text)
            if m:
                contact_phone = m.group(1)
            link = detail.find("a", href=re.compile(r"/Competition|/Search/Details|/Details|print", re.I))
            if link and link.get("href"):
                source_url = urljoin(_BASE_URL, link["href"])

        description = "\n\n".join(p for p in (synopsis, additional) if p) or None
        status = OpportunityStatus.OPEN if status_raw.lower().startswith("open") else OpportunityStatus.UNKNOWN
        self._diag.rows_parsed += 1

        return OpportunityCreate(
            source_id=self.source_config.id,
            external_id=number or None,
            title=title,
            description_summary=(synopsis or description or "")[:500] or None,
            description_full=description,
            status=status,
            country="CA",
            region="SK",
            location_raw="Saskatchewan, Canada",
            posted_date=(self._parse_dt(open_raw) or datetime.now(timezone.utc)).date(),
            closing_date=self._parse_dt(close_raw),
            project_type=competition_type,
            category="Provincial Procurement",
            solicitation_number=number or None,
            currency="CAD",
            contact_name=contact_name,
            contact_email=contact_email,
            contact_phone=contact_phone,
            source_url=source_url,
            has_documents=True,
            organization_name=org or None,
            raw_data={
                "parser_version": "sasktenders_v2",
                "competition_number": number,
                "competition_type": competition_type,
                "open_date_raw": open_raw,
                "close_date_raw": close_raw,
                "status": status_raw,
                "fetch_timestamp": datetime.now(timezone.utc).isoformat(),
            },
            fingerprint="",
        )

    @staticmethod
    def _section_text(detail, heading: str) -> str | None:
        h = detail.find(["h3", "h4", "strong", "th"], string=re.compile(rf"^\s*{re.escape(heading)}:?\s*$", re.I))
        if not h:
            return None
        body = h.find_next_sibling()
        if body is None:
            return None
        text = body.get_text(" ", strip=True)
        return re.sub(r"\s+", " ", text).strip() or None

    @staticmethod
    def _parse_dt(raw: str) -> datetime | None:
        m = _DATE_RE.search(raw or "")
        if not m:
            return None
        date_part, time_part = m.group(1), m.group(2)
        try:
            mon, day, year = date_part.replace(",", "").split()
            hour, minute = 23, 59
            if time_part:
                hm, ampm = time_part.split()
                hour, minute = (int(x) for x in hm.split(":"))
                if ampm == "PM" and hour != 12:
                    hour += 12
                if ampm == "AM" and hour == 12:
                    hour = 0
            # Saskatchewan is UTC-6 year-round (CST)
            local = datetime(int(year), _MONTHS[mon], int(day), hour, minute)
            return (local - __import__("datetime").timedelta(hours=-6)).replace(tzinfo=timezone.utc) if False else local.replace(tzinfo=timezone(__import__("datetime").timedelta(hours=-6))).astimezone(timezone.utc)
        except (ValueError, KeyError):
            return None
