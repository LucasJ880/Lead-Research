"""Generic parser driven by CSS selectors from crawl_config."""

from __future__ import annotations

from bs4 import BeautifulSoup

from src.parsers.base import BaseParser


class GenericParser(BaseParser):
    """Parser that uses configurable CSS selectors.

    ``crawl_config`` is expected to contain:

    - ``listing_selector``: CSS selector for each item container
    - ``link_selector``: selector for the item link (relative to container)
    - ``title_selector``: selector for the item title (relative to container)
    - ``detail_fields``: mapping of field name → CSS selector for detail pages
    """

    def __init__(self, crawl_config: dict) -> None:
        self._config = crawl_config

    def parse_listing(self, html: str) -> list[dict]:
        """Extract items from a listing page using configured selectors.

        Returns:
            List of dicts with ``title``, ``url``, and any extra listing-level
            fields found.
        """
        soup = BeautifulSoup(html, "lxml")
        listing_selector = self._config.get("listing_selector", "")
        link_selector = self._config.get("link_selector", "a")
        title_selector = self._config.get("title_selector", "")

        if not listing_selector:
            return []

        containers = soup.select(listing_selector)
        items: list[dict] = []

        for container in containers:
            item: dict = {}

            link_el = container.select_one(link_selector)
            if link_el:
                item["url"] = link_el.get("href", "")

            if title_selector:
                title_text = self.extract_text(container, title_selector)
            elif link_el:
                title_text = self.clean_text(link_el.get_text(strip=True))
            else:
                title_text = None

            if title_text:
                item["title"] = title_text

            # Extract any extra listing-level fields
            listing_fields = self._config.get("listing_fields", {})
            for field_name, selector in listing_fields.items():
                value = self.extract_text(container, selector)
                if value:
                    item[field_name] = value

            if item.get("title") or item.get("url"):
                items.append(item)

        return items

    def parse_detail(self, html: str) -> dict:
        """Extract fields from a detail page using ``detail_fields`` selectors.

        Returns:
            Dict of field name → extracted text value.
        """
        soup = BeautifulSoup(html, "lxml")
        detail_fields: dict = self._config.get("detail_fields", {})
        data: dict = {}

        for field_name, selector in detail_fields.items():
            value = self.extract_text(soup, selector)
            if value:
                data[field_name] = value

        return data
