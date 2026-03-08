"""Business relevance scoring engine for window-covering opportunities."""

from __future__ import annotations

import re

from src.core.logging import get_logger

logger = get_logger(__name__)

# ─── Keyword Dictionaries ───────────────────────────────────
# These lists are the business core of LeadHarvest.
# Changing them affects which opportunities surface to the user.

PRIMARY_KEYWORDS: dict[str, int] = {
    "blinds": 40,
    "roller blinds": 40,
    "zebra blinds": 40,
    "window coverings": 40,
    "curtains": 40,
    "drapery": 40,
    "drapes": 40,
    "shades": 35,
    "solar shades": 40,
    "blackout shades": 40,
    "motorized shades": 40,
    "skylight shades": 40,
    "privacy curtains": 40,
    "drapery track": 40,
    "drapery tracks": 40,
    "window treatment": 40,
    "window treatments": 40,
    "roller shades": 40,
    "custom shades": 40,
    "exterior shades": 40,
    "commercial blinds": 40,
    "venetian blinds": 40,
    "vertical blinds": 40,
    "honeycomb shades": 40,
    "cellular shades": 40,
    "roman shades": 40,
    "sheer shades": 40,
    "panel track blinds": 40,
    "plantation shutters": 40,
    "window film": 35,
    "shade systems": 40,
    "motorized window": 40,
    "automated shades": 40,
}

SECONDARY_KEYWORDS: dict[str, int] = {
    "interior furnishing": 20,
    "interior furnishings": 20,
    "ff&e": 20,
    "furniture fixtures equipment": 20,
    "furniture fixtures and equipment": 20,
    "renovation": 20,
    "school modernization": 20,
    "hospital renovation": 20,
    "building upgrade": 20,
    "facility improvement": 20,
    "interior fit-out": 20,
    "tenant improvement": 20,
    "furnishing": 20,
    "design-build": 20,
    "condo development": 20,
    "apartment development": 20,
    "hospitality renovation": 20,
    "office fit-out": 20,
    "interior finishing": 20,
    "millwork": 15,
    "soft furnishing": 20,
    "window replacement": 20,
    "building envelope": 15,
    "interior design services": 20,
    "commercial interiors": 20,
}

PROJECT_TYPE_KEYWORDS: dict[str, int] = {
    "school renovation": 15,
    "hospital renovation": 15,
    "senior living": 15,
    "public housing": 15,
    "hotel construction": 15,
    "office construction": 15,
    "university residence": 15,
    "dormitory": 15,
    "healthcare facility": 15,
    "government building": 15,
    "courthouse": 15,
    "library": 12,
    "community center": 12,
    "recreation center": 12,
    "fire station": 10,
    "police station": 10,
    "correctional facility": 10,
}

NEGATIVE_KEYWORDS: list[str] = [
    "software",
    "it services",
    "vehicles",
    "road construction",
    "bridge",
    "sewer",
    "water main",
    "paving",
    "landscaping only",
    "demolition only",
    "plumbing only",
    "electrical only",
    "hvac only",
]

_PRIMARY_PATTERNS: list[tuple[str, int, re.Pattern]] = [
    (kw, score, re.compile(re.escape(kw), re.IGNORECASE))
    for kw, score in PRIMARY_KEYWORDS.items()
]

_SECONDARY_PATTERNS: list[tuple[str, int, re.Pattern]] = [
    (kw, score, re.compile(re.escape(kw), re.IGNORECASE))
    for kw, score in SECONDARY_KEYWORDS.items()
]

_PROJECT_PATTERNS: list[tuple[str, int, re.Pattern]] = [
    (kw, score, re.compile(re.escape(kw), re.IGNORECASE))
    for kw, score in PROJECT_TYPE_KEYWORDS.items()
]

_NEGATIVE_PATTERNS: list[tuple[str, re.Pattern]] = [
    (kw, re.compile(re.escape(kw), re.IGNORECASE))
    for kw in NEGATIVE_KEYWORDS
]

_ORG_TYPE_BONUS: dict[str, int] = {
    "government": 5,
    "education": 5,
    "healthcare": 5,
    "housing": 10,
}


def score_opportunity(
    title: str,
    description: str,
    org_type: str | None = None,
    project_type: str | None = None,
) -> tuple[int, dict]:
    """Score how relevant an opportunity is to the window-covering business.

    Returns:
        A tuple of ``(score, breakdown)`` where score is clamped to 0-100
        and breakdown is a dict explaining how the score was derived.
    """
    combined = f"{title or ''} {description or ''} {project_type or ''}"
    raw_score = 0

    primary_matches: list[str] = []
    secondary_matches: list[str] = []
    project_matches: list[str] = []
    negative_matches: list[str] = []
    org_bonus = 0

    for kw, points, pattern in _PRIMARY_PATTERNS:
        if pattern.search(combined):
            primary_matches.append(kw)
            raw_score += points

    for kw, points, pattern in _SECONDARY_PATTERNS:
        if pattern.search(combined):
            secondary_matches.append(kw)
            raw_score += points

    for kw, points, pattern in _PROJECT_PATTERNS:
        if pattern.search(combined):
            project_matches.append(kw)
            raw_score += points

    if org_type and org_type.lower() in _ORG_TYPE_BONUS:
        org_bonus = _ORG_TYPE_BONUS[org_type.lower()]
        raw_score += org_bonus

    for kw, pattern in _NEGATIVE_PATTERNS:
        if pattern.search(combined):
            negative_matches.append(kw)

    if negative_matches and not primary_matches:
        raw_score = max(0, raw_score - 30)

    final_score = max(0, min(100, raw_score))

    breakdown = {
        "primary_matches": primary_matches,
        "secondary_matches": secondary_matches,
        "project_matches": project_matches,
        "negative_matches": negative_matches,
        "org_bonus": org_bonus,
        "final_score": final_score,
    }

    return final_score, breakdown
