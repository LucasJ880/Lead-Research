"""Abstract base parser for extracting opportunity data from HTML."""

from __future__ import annotations

import re
from abc import ABC, abstractmethod

from bs4 import BeautifulSoup, Tag


class BaseParser(ABC):
    """Base class for all HTML parsers."""

    @abstractmethod
    def parse_listing(self, html: str) -> list[dict]:
        """Extract a list of item dicts from a listing page.

        Each dict should contain at minimum ``title`` and ``url`` keys.
        """
        ...

    @abstractmethod
    def parse_detail(self, html: str) -> dict:
        """Extract field values from a detail page."""
        ...

    # ─── Utilities ──────────────────────────────────────────

    @staticmethod
    def clean_text(text: str) -> str:
        """Strip leading/trailing whitespace and collapse internal runs."""
        if not text:
            return ""
        return re.sub(r"\s+", " ", text.strip())

    @staticmethod
    def extract_text(soup: BeautifulSoup | Tag, selector: str) -> str | None:
        """Safely select an element and return its stripped text, or None."""
        el = soup.select_one(selector)
        if el is None:
            return None
        text = el.get_text(separator=" ", strip=True)
        return text if text else None
