"""SaskTenders crawler — Government of Saskatchewan procurement portal.

Parses the server-rendered accordion HTML from sasktenders.ca/content/public/Search.aspx.
Each listing is a pair of divs: a HeaderAccordionPlusFormat containing a
ContentAccordionFormat table (title, org, competition #, dates, status)
followed by a DetailContentAccordionFormat table (synopsis, contacts, docs).
"""

from __future__ import annotations

import re
from datetime import datetime, timezone
from urllib.parse import urljoin

from bs4 import BeautifulSoup, Tag

from src.crawlers.base import BaseCrawler
from src.models.opportunity import OpportunityCreate, OpportunityStatus


_DATE_RE = re.compile(
    r"([A-Z][a-z]{2}\s+\d{1,2},\s+\d{4})",
    re.IGNORECASE,
)

_BASE_URL = "https://sasktenders.ca"
_SEARCH_URL = f"{_BASE_URL}/content/public/Search.aspx"


def _parse_date(raw: str) -> datetime | None:
    """Extract 'Mar 07, 2026' from text that may include a time portion."""
    m = _DATE_RE.search(raw.strip())
    if not m:
        return None
    try:
        dt = datetime.strptime(m.group(1), "%b %d, %Y")
        return dt.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def _clean(text: str) -> str:
    return " ".join(text.split()).strip()


class SaskTendersCrawler(BaseCrawler):
    """Crawl the SaskTenders public search page for open competitions."""

    def crawl(self) -> list[OpportunityCreate]:
        self.logger.info("Fetching SaskTenders listing page: %s", _SEARCH_URL)
        html = self.fetch_page(_SEARCH_URL)
        if not html:
            self.logger.error("Failed to fetch SaskTenders page")
            return []

        soup = BeautifulSoup(html, "lxml")

        header_divs = soup.find_all("div", class_="HeaderAccordionPlusFormat")
        detail_divs = soup.find_all("div", class_="ContentAccordionFormat_SearchPage")

        self.logger.info("Found %d header sections, %d detail sections",
                         len(header_divs), len(detail_divs))

        opportunities: list[OpportunityCreate] = []

        for idx, header in enumerate(header_divs):
            try:
                opp = self._parse_pair(
                    header,
                    detail_divs[idx] if idx < len(detail_divs) else None,
                )
                if opp:
                    opportunities.append(opp)
            except Exception:
                self.logger.exception("Error parsing listing #%d", idx)

        self.logger.info("Parsed %d opportunities from SaskTenders", len(opportunities))
        return opportunities

    def _parse_pair(
        self, header_div: Tag, detail_div: Tag | None
    ) -> OpportunityCreate | None:
        """Parse one header + detail pair into an OpportunityCreate."""
        summary_table = header_div.find("table", class_="ContentAccordionFormat")
        if not summary_table:
            return None

        cells = summary_table.find_all("td", valign="top")
        if len(cells) < 7:
            return None

        title = _clean(cells[1].get_text())
        org_name = _clean(cells[2].get_text())
        competition_num = _clean(cells[3].get_text())
        open_date_raw = _clean(cells[4].get_text())
        close_date_raw = _clean(cells[5].get_text())
        status_raw = _clean(cells[6].get_text()).lower()

        if not title:
            return None

        posted_date = _parse_date(open_date_raw)
        closing_date = _parse_date(close_date_raw)

        status = OpportunityStatus.OPEN
        if "closed" in status_raw:
            status = OpportunityStatus.CLOSED
        elif "awarded" in status_raw:
            status = OpportunityStatus.AWARDED
        elif "cancelled" in status_raw:
            status = OpportunityStatus.CANCELLED

        description = ""
        contact_name = None
        contact_email = None
        contact_phone = None
        competition_type = None

        if detail_div:
            desc_table = detail_div.find("table", class_="DetailContentAccordionFormat")
            if desc_table:
                h2 = desc_table.find("h2")
                synopsis_th = desc_table.find("th", string=re.compile(r"Synopsis", re.I))
                if synopsis_th:
                    synopsis_td = synopsis_th.find_next("td")
                    if synopsis_td:
                        description = _clean(synopsis_td.get_text())

                comp_type_th = desc_table.find("th", string=re.compile(r"Competition Type", re.I))
                if comp_type_th:
                    comp_type_td = comp_type_th.find_next("td")
                    if comp_type_td:
                        competition_type = _clean(comp_type_td.get_text())

                contact_th = desc_table.find("th", string=re.compile(r"Contact:", re.I))
                if contact_th:
                    contact_td = contact_th.find_next("td")
                    if contact_td:
                        contact_name = _clean(contact_td.get_text())

                phone_th = desc_table.find("th", string=re.compile(r"Phone:", re.I))
                if phone_th:
                    phone_td = phone_th.find_next("td")
                    if phone_td:
                        contact_phone = _clean(phone_td.get_text())

                email_link = desc_table.find("a", href=re.compile(r"^mailto:"))
                if email_link:
                    contact_email = email_link.get_text(strip=True)

        print_link = header_div.find("a", href=re.compile(r"print\.aspx"))
        source_url = _SEARCH_URL
        if print_link and print_link.get("href"):
            source_url = urljoin(_BASE_URL, print_link["href"])

        return OpportunityCreate(
            source_id=self.source_config.id,
            external_id=competition_num or None,
            title=title,
            description_summary=description[:500] if description else None,
            description_full=description or None,
            status=status,
            country="CA",
            region="SK",
            location_raw="Saskatchewan, Canada",
            posted_date=posted_date.date() if posted_date else None,
            closing_date=closing_date,
            project_type=competition_type,
            category="Procurement",
            solicitation_number=competition_num or None,
            currency="CAD",
            contact_name=contact_name,
            contact_email=contact_email,
            contact_phone=contact_phone,
            source_url=source_url,
            has_documents=True,
            organization_name=org_name or None,
            raw_data={
                "parser_version": "sasktenders_v1",
                "competition_number": competition_num,
                "competition_type": competition_type,
                "open_date_raw": open_date_raw,
                "close_date_raw": close_date_raw,
                "status_raw": status_raw,
                "fetch_timestamp": datetime.now(timezone.utc).isoformat(),
            },
            fingerprint="",
        )
