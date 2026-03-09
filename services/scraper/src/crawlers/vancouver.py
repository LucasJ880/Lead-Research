"""City of Vancouver crawler — public open bids page.

The City of Vancouver publishes open bids at bids.vancouver.ca as a plain
HTML table. Detail pages are hosted on Jaggaer and require login, so we
only extract data from the listing page (title, status, link).
"""

from __future__ import annotations

from datetime import datetime, timezone

from bs4 import BeautifulSoup

from src.crawlers.base import BaseCrawler
from src.models.opportunity import OpportunityCreate, OpportunityStatus

_LISTING_URL = "https://bids.vancouver.ca/pages/bids.show/openbids.htm"


def _clean(text: str) -> str:
    return " ".join(text.split()).strip()


class VancouverCrawler(BaseCrawler):
    """Crawl City of Vancouver open bids listing page."""

    def crawl(self) -> list[OpportunityCreate]:
        self._http.headers.update({
            "User-Agent": (
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/120.0.0.0 Safari/537.36"
            ),
            "Accept": "text/html,application/xhtml+xml",
        })

        self.logger.info("Fetching Vancouver open bids: %s", _LISTING_URL)
        html = self.fetch_page(_LISTING_URL)
        if not html:
            self.logger.error("Failed to fetch Vancouver bids page")
            return []

        soup = BeautifulSoup(html, "lxml")
        tables = soup.find_all("table")
        if not tables:
            self.logger.error("No tables found on Vancouver bids page")
            return []

        main_table = tables[0]
        rows = main_table.find_all("tr")[1:]  # Skip header

        opportunities: list[OpportunityCreate] = []
        for row in rows:
            try:
                opp = self._parse_row(row)
                if opp:
                    opportunities.append(opp)
            except Exception:
                self.logger.exception("Error parsing Vancouver bid row")

        self.logger.info("Parsed %d opportunities from Vancouver open bids", len(opportunities))
        return opportunities

    def _parse_row(self, row) -> OpportunityCreate | None:
        tds = row.find_all("td")
        if len(tds) < 2:
            return None

        status_text = _clean(tds[0].get_text()).lower()
        status = OpportunityStatus.OPEN
        if "closed" in status_text:
            status = OpportunityStatus.CLOSED

        detail_td = tds[1]
        link = detail_td.find("a", href=True)
        if not link:
            return None

        title = _clean(link.get_text())
        if not title:
            return None

        source_url = link.get("href", "")
        if not source_url.startswith("http"):
            source_url = f"https://bids.vancouver.ca{source_url}"

        return OpportunityCreate(
            source_id=self.source_config.id,
            external_id=None,
            title=title,
            description_summary=None,
            description_full=None,
            status=status,
            country="CA",
            region="BC",
            city="Vancouver",
            location_raw="Vancouver, British Columbia, Canada",
            posted_date=None,
            closing_date=None,
            project_type="Municipal Procurement",
            category="Municipal",
            solicitation_number=None,
            currency="CAD",
            source_url=source_url,
            has_documents=True,
            organization_name="City of Vancouver",
            raw_data={
                "parser_version": "vancouver_v1",
                "fetch_timestamp": datetime.now(timezone.utc).isoformat(),
            },
            fingerprint="",
        )
