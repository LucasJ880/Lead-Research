"""Data normalization utilities for scraped opportunity fields."""

from __future__ import annotations

import hashlib
import html as html_lib
import re
from datetime import date, timedelta
from decimal import Decimal, InvalidOperation

from dateutil import parser as dateutil_parser

from src.core.logging import get_logger

logger = get_logger(__name__)

# ─── Date Normalization ─────────────────────────────────────

_RELATIVE_DATE_PATTERNS: list[tuple[re.Pattern, int]] = [
    (re.compile(r"today", re.IGNORECASE), 0),
    (re.compile(r"tomorrow", re.IGNORECASE), 1),
    (re.compile(r"yesterday", re.IGNORECASE), -1),
    (re.compile(r"(\d+)\s*days?\s*(?:from\s*now|away|left)", re.IGNORECASE), None),
]


def normalize_date(date_str: str) -> date | None:
    """Parse a date string in various US/CA formats into a ``date`` object.

    Supported formats include:
    - ISO:      ``2025-03-15``
    - US:       ``03/15/2025``, ``3/15/2025``
    - Long:     ``March 15, 2025``, ``Mar 15 2025``
    - Dashed:   ``15-Mar-2025``
    - Relative: ``today``, ``tomorrow``, ``3 days from now``

    Returns:
        Parsed ``date`` or ``None`` if unparseable.
    """
    if not date_str or not date_str.strip():
        return None

    text = date_str.strip()

    # Relative dates
    for pattern, delta in _RELATIVE_DATE_PATTERNS:
        m = pattern.search(text)
        if m:
            if delta is not None:
                return date.today() + timedelta(days=delta)
            days = int(m.group(1))
            return date.today() + timedelta(days=days)

    try:
        # dayfirst=False favours MM/DD/YYYY (US) over DD/MM/YYYY
        parsed = dateutil_parser.parse(text, dayfirst=False, fuzzy=True)
        return parsed.date()
    except (ValueError, OverflowError):
        logger.debug("Unable to parse date: %s", text)
        return None


# ─── Location Normalization ─────────────────────────────────

_CA_PROVINCES = {
    "AB": "Alberta", "BC": "British Columbia", "MB": "Manitoba",
    "NB": "New Brunswick", "NL": "Newfoundland and Labrador",
    "NS": "Nova Scotia", "NT": "Northwest Territories", "NU": "Nunavut",
    "ON": "Ontario", "PE": "Prince Edward Island", "QC": "Quebec",
    "SK": "Saskatchewan", "YT": "Yukon",
}
_US_STATES = {
    "AL": "Alabama", "AK": "Alaska", "AZ": "Arizona", "AR": "Arkansas",
    "CA": "California", "CO": "Colorado", "CT": "Connecticut",
    "DE": "Delaware", "FL": "Florida", "GA": "Georgia", "HI": "Hawaii",
    "ID": "Idaho", "IL": "Illinois", "IN": "Indiana", "IA": "Iowa",
    "KS": "Kansas", "KY": "Kentucky", "LA": "Louisiana", "ME": "Maine",
    "MD": "Maryland", "MA": "Massachusetts", "MI": "Michigan",
    "MN": "Minnesota", "MS": "Mississippi", "MO": "Missouri",
    "MT": "Montana", "NE": "Nebraska", "NV": "Nevada",
    "NH": "New Hampshire", "NJ": "New Jersey", "NM": "New Mexico",
    "NY": "New York", "NC": "North Carolina", "ND": "North Dakota",
    "OH": "Ohio", "OK": "Oklahoma", "OR": "Oregon", "PA": "Pennsylvania",
    "RI": "Rhode Island", "SC": "South Carolina", "SD": "South Dakota",
    "TN": "Tennessee", "TX": "Texas", "UT": "Utah", "VT": "Vermont",
    "VA": "Virginia", "WA": "Washington", "WV": "West Virginia",
    "WI": "Wisconsin", "WY": "Wyoming", "DC": "District of Columbia",
}

_ABBREV_TO_NAME: dict[str, str] = {**_US_STATES, **_CA_PROVINCES}
_NAME_TO_ABBREV: dict[str, str] = {v.lower(): k for k, v in _ABBREV_TO_NAME.items()}


def normalize_location(location_str: str, country: str = "US") -> dict[str, str | None]:
    """Best-effort extraction of country, region, and city from free text.

    Args:
        location_str: Raw location string (e.g. "Toronto, ON" or "Austin, TX 78701").
        country: Default country code.

    Returns:
        Dict with ``country``, ``region``, ``city`` keys.
    """
    result: dict[str, str | None] = {"country": country.upper(), "region": None, "city": None}
    if not location_str:
        return result

    text = re.sub(r"\d{5}(-\d{4})?", "", location_str).strip()  # strip US zip
    text = re.sub(r"[A-Z]\d[A-Z]\s?\d[A-Z]\d", "", text, flags=re.IGNORECASE).strip()  # strip CA postal

    parts = [p.strip() for p in text.split(",") if p.strip()]

    if len(parts) >= 2:
        region_candidate = parts[-1].strip()
        city_candidate = parts[0].strip()

        abbrev = region_candidate.upper()
        if abbrev in _ABBREV_TO_NAME:
            result["region"] = abbrev
        elif region_candidate.lower() in _NAME_TO_ABBREV:
            result["region"] = _NAME_TO_ABBREV[region_candidate.lower()]
        else:
            result["region"] = region_candidate

        result["city"] = city_candidate

        if abbrev in _CA_PROVINCES:
            result["country"] = "CA"
        elif abbrev in _US_STATES:
            result["country"] = "US"
    elif len(parts) == 1:
        token = parts[0].upper()
        if token in _ABBREV_TO_NAME:
            result["region"] = token
        else:
            result["city"] = parts[0]

    return result


# ─── Status Normalization ───────────────────────────────────

_STATUS_MAP: dict[str, str] = {
    "open": "open",
    "active": "open",
    "accepting bids": "open",
    "accepting submissions": "open",
    "posted": "open",
    "new": "open",
    "closed": "closed",
    "expired": "closed",
    "deadline passed": "closed",
    "no longer accepting": "closed",
    "awarded": "awarded",
    "contract awarded": "awarded",
    "cancelled": "cancelled",
    "canceled": "cancelled",
    "withdrawn": "cancelled",
    "archived": "archived",
    "completed": "archived",
}


def normalize_status(status_str: str) -> str:
    """Map a raw status string to a canonical enum value.

    Returns:
        One of ``open``, ``closed``, ``awarded``, ``cancelled``,
        ``archived``, or ``unknown``.
    """
    if not status_str:
        return "unknown"
    key = status_str.strip().lower()
    return _STATUS_MAP.get(key, "unknown")


# ─── Currency Normalization ─────────────────────────────────

_CURRENCY_SYMBOLS: dict[str, str] = {
    "$": "USD",
    "C$": "CAD",
    "CA$": "CAD",
    "CAD": "CAD",
    "USD": "USD",
    "€": "EUR",
    "£": "GBP",
}


def normalize_currency(value_str: str) -> tuple[Decimal | None, str]:
    """Extract a numeric value and currency code from a string.

    Examples:
        ``"$1,250,000.00"`` → ``(Decimal("1250000.00"), "USD")``
        ``"CAD 500,000"``   → ``(Decimal("500000"), "CAD")``

    Returns:
        Tuple of (amount or None, currency code).
    """
    if not value_str:
        return None, "USD"

    text = value_str.strip()
    currency = "USD"

    for symbol, code in sorted(_CURRENCY_SYMBOLS.items(), key=lambda x: -len(x[0])):
        if symbol in text.upper():
            currency = code
            text = text.upper().replace(symbol, "").strip()
            break

    text = re.sub(r"[^\d.]", "", text)

    try:
        return Decimal(text), currency
    except (InvalidOperation, ValueError):
        return None, currency


# ─── HTML Cleaning ──────────────────────────────────────────


def clean_html(html: str) -> str:
    """Strip HTML tags and decode entities, returning plain text."""
    if not html:
        return ""
    text = re.sub(r"<[^>]+>", " ", html)
    text = html_lib.unescape(text)
    return re.sub(r"\s+", " ", text).strip()


# ─── Fingerprinting ─────────────────────────────────────────


def generate_fingerprint(
    title: str,
    org: str,
    closing_date: str,
    url: str,
) -> str:
    """Produce a stable SHA-256 fingerprint for deduplication.

    The fingerprint is built from the lowercased, whitespace-stripped
    concatenation of the provided fields.
    """
    parts = [
        (title or "").strip().lower(),
        (org or "").strip().lower(),
        (closing_date or "").strip().lower(),
        (url or "").strip().lower(),
    ]
    raw = "|".join(parts)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()
