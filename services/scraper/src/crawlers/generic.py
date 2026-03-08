"""Generic crawler that uses configurable CSS selectors from crawl_config."""

from __future__ import annotations

from urllib.parse import urljoin

from sqlalchemy.orm import Session

from src.core.config import settings
from src.crawlers.base import BaseCrawler
from src.models.opportunity import OpportunityCreate, SourceConfig
from src.parsers.generic import GenericParser


class GenericCrawler(BaseCrawler):
    """Configurable crawler driven by CSS selectors stored in ``crawl_config``.

    Expected ``crawl_config`` keys::

        {
            "listing_url": "/bids?page={page}",
            "listing_selector": "tr.bid-row",
            "link_selector": "a.bid-link",
            "title_selector": "a.bid-link",
            "next_page_selector": "a.next",       // optional
            "page_param": "page",                  // optional, default "page"
            "detail_fields": {                     // optional
                "description_full": ".bid-description",
                "closing_date": ".close-date",
                "contact_name": ".contact-name",
                "contact_email": ".contact-email",
                ...
            }
        }
    """

    def __init__(self, source_config: SourceConfig, session: Session) -> None:
        super().__init__(source_config, session)
        self._parser = GenericParser(source_config.crawl_config)

    def crawl(self) -> list[OpportunityCreate]:
        """Crawl listing pages and optional detail pages.

        Returns:
            Parsed opportunities ready for the pipeline.
        """
        cfg = self.source_config.crawl_config
        max_pages = cfg.get("max_pages", settings.DEFAULT_MAX_PAGES_PER_SOURCE)
        listing_url_template = cfg.get("listing_url", "")
        page_param = cfg.get("page_param", "page")
        next_page_selector = cfg.get("next_page_selector")
        fetch_details = bool(cfg.get("detail_fields"))

        opportunities: list[OpportunityCreate] = []
        page = 1

        while page <= max_pages:
            url = self._build_listing_url(listing_url_template, page_param, page)
            self.logger.info("Crawling listing page %d: %s", page, url)

            html = self.fetch_page(url)
            if not html:
                break

            items = self._parser.parse_listing(html)
            if not items:
                self.logger.info("No items found on page %d — stopping", page)
                break

            for item in items:
                try:
                    opp = self._process_item(item, fetch_details)
                    if opp:
                        opportunities.append(opp)
                except Exception:
                    self.logger.exception("Error processing item: %s", item.get("title", "unknown"))

            if next_page_selector:
                from bs4 import BeautifulSoup

                soup = BeautifulSoup(html, "lxml")
                next_link = soup.select_one(next_page_selector)
                if not next_link or not next_link.get("href"):
                    break
            page += 1

        self.logger.info("Crawl complete: %d opportunities extracted", len(opportunities))
        return opportunities

    # ─── Helpers ────────────────────────────────────────────

    def _build_listing_url(self, template: str, page_param: str, page: int) -> str:
        """Construct the full listing URL for a given page number."""
        base = self.source_config.base_url.rstrip("/")
        if "{page}" in template:
            path = template.replace("{page}", str(page))
        elif "?" in template:
            path = f"{template}&{page_param}={page}"
        else:
            path = f"{template}?{page_param}={page}"
        return urljoin(base, path)

    def _process_item(
        self,
        item: dict,
        fetch_details: bool,
    ) -> OpportunityCreate | None:
        """Optionally fetch a detail page and build an OpportunityCreate."""
        detail_url = item.get("url")
        detail_data: dict = {}

        if fetch_details and detail_url:
            abs_url = urljoin(self.source_config.base_url, detail_url)
            detail_html = self.fetch_page(abs_url)
            if detail_html:
                detail_data = self._parser.parse_detail(detail_html)
            item["url"] = abs_url

        merged = {**item, **detail_data}
        source_url = merged.get("url") or merged.get("source_url", "")
        if not source_url:
            source_url = self.source_config.base_url

        return OpportunityCreate(
            source_id=self.source_config.id,
            external_id=merged.get("external_id"),
            title=merged.get("title", "Untitled"),
            description_summary=merged.get("description_summary"),
            description_full=merged.get("description_full"),
            country=self.source_config.country,
            region=self.source_config.region,
            city=self.source_config.city,
            location_raw=merged.get("location_raw"),
            posted_date=merged.get("posted_date"),
            closing_date=merged.get("closing_date"),
            project_type=merged.get("project_type"),
            category=merged.get("category"),
            solicitation_number=merged.get("solicitation_number"),
            estimated_value=merged.get("estimated_value"),
            currency=merged.get("currency", "USD"),
            contact_name=merged.get("contact_name"),
            contact_email=merged.get("contact_email"),
            contact_phone=merged.get("contact_phone"),
            source_url=source_url,
            has_documents=merged.get("has_documents", False),
            mandatory_site_visit=merged.get("mandatory_site_visit"),
            pre_bid_meeting=merged.get("pre_bid_meeting"),
            organization_name=merged.get("organization_name"),
            raw_data=merged,
            fingerprint="",  # populated by the pipeline
        )
