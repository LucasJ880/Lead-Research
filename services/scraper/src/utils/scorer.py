"""Relevance Engine v3 — window-covering focused opportunity intelligence scorer.

Classifies every opportunity into one of four relevance buckets, assigns a
0–100 score, derives industry tags, and generates a human-readable
business_fit_explanation that tells the admin exactly why the opportunity
scored the way it did.

Scoring formula:
  raw = (primary + secondary + contextual + semantic + title_boost
         + org_bonus + source_fit_bonus + category_bonus) − negative_penalty
  final = clamp(raw, 0, 100)

Buckets:
  highly_relevant  70-100  → Direct product match or strong semantic signal
  moderately_relevant 40-69  → Adjacent products, furnishing/textile supply
  low_relevance    15-39  → Weak contextual signal, renovation context
  irrelevant        0-14  → No meaningful connection to the business
"""

from __future__ import annotations

import re
from typing import Any

from src.core.logging import get_logger

logger = get_logger(__name__)

# ───────────────────────────────────────────────────────────────────────
# KEYWORD DICTIONARIES
# ───────────────────────────────────────────────────────────────────────
# Weights reflect how directly a keyword maps to the business.

PRIMARY_KEYWORDS: dict[str, int] = {
    # ── blinds ────────────────────────────
    "blinds": 45,
    "blind": 30,
    "roller blinds": 50,
    "roller blind": 50,
    "zebra blinds": 50,
    "zebra blind": 50,
    "venetian blinds": 50,
    "venetian blind": 50,
    "vertical blinds": 50,
    "vertical blind": 50,
    "mini blinds": 45,
    "mini-blinds": 45,
    "panel track blinds": 45,
    "commercial blinds": 50,
    "wood blinds": 45,
    "faux wood blinds": 45,
    "aluminum blinds": 45,
    # ── shades ────────────────────────────
    "shade": 35,
    "shades": 35,
    "roller shade": 50,
    "roller shades": 50,
    "solar shades": 50,
    "solar shade": 50,
    "blackout shades": 50,
    "blackout shade": 50,
    "motorized shades": 50,
    "motorized shade": 50,
    "skylight shades": 50,
    "skylight shade": 50,
    "honeycomb shades": 45,
    "cellular shades": 45,
    "roman shades": 45,
    "sheer shades": 45,
    "custom shades": 45,
    "exterior shades": 45,
    "shade systems": 45,
    "automated shades": 50,
    "blackout systems": 45,
    "blackout": 30,
    "pleated shades": 45,
    "dual shades": 45,
    # ── curtains / drapery ────────────────
    "curtain": 40,
    "curtains": 45,
    "drapery": 50,
    "drapes": 45,
    "drape": 40,
    "privacy curtain": 50,
    "privacy curtains": 50,
    "cubicle curtain": 50,
    "cubicle curtains": 50,
    "hospital curtain": 50,
    "hospital curtains": 50,
    "drapery track": 50,
    "drapery tracks": 50,
    "room divider curtain": 45,
    "patient room curtain": 50,
    "shower curtain": 30,
    "stage curtain": 35,
    "acoustic curtain": 40,
    "thermal curtain": 40,
    "blackout curtain": 50,
    "blackout curtains": 50,
    # ── shutters ───────────────────────────
    "shutters": 40,
    "shutter": 35,
    "plantation shutters": 45,
    "plantation shutter": 45,
    "interior shutters": 45,
    "window shutters": 45,
    # ── liners ────────────────────────────
    "liner": 30,
    "liners": 30,
    "curtain liner": 45,
    "curtain liners": 45,
    "shower liner": 25,
    # ── window covering catch-all ─────────
    "window covering": 50,
    "window coverings": 50,
    "window treatment": 50,
    "window treatments": 50,
    "motorized window": 45,
    "window film": 30,
    "window shade": 45,
    "window blind": 45,
    "window": 8,
}

SECONDARY_KEYWORDS: dict[str, int] = {
    # ── textile / fabric ──────────────────
    "fabric": 12,
    "textile": 15,
    "textiles": 15,
    "soft furnishing": 30,
    "soft furnishings": 30,
    "soft goods": 25,
    # ── bedding / towels / linen (textile supply) ──
    "blanket": 20,
    "blankets": 20,
    "bedding": 20,
    "bed linen": 20,
    "towel": 15,
    "towels": 15,
    "linen": 15,
    "linens": 15,
    "bag": 10,
    "bags": 10,
    "tote bag": 12,
    "sock": 10,
    "socks": 10,
    "mask": 10,
    "masks": 10,
    "face mask": 12,
    # ── standing agreement / contract types ──
    "standing agreement": 25,
    "standing offer": 25,
    "supply agreement": 20,
    "blanket purchase agreement": 20,
    "master agreement": 20,
    # ── furnishing / FF&E / furniture ──────
    "furniture": 25,
    "furnishing": 20,
    "furnishings": 20,
    "interior furnishing": 25,
    "interior furnishings": 25,
    "interior finishings": 20,
    "interior finishing": 20,
    "ff&e": 25,
    "ffe": 20,
    "furniture fixtures equipment": 25,
    "furniture fixtures and equipment": 25,
    "commercial furnishing": 25,
    "interior fit-out": 25,
    "interior fitout": 25,
    "tenant improvement": 20,
    "office fit-out": 20,
    "interior design": 15,
    "commercial interiors": 20,
    "finish carpentry": 15,
    "millwork and finishing": 15,
}

CONTEXTUAL_KEYWORDS: dict[str, int] = {
    "hospital renovation": 15,
    "school renovation": 15,
    "hospitality renovation": 15,
    "condo furnishing": 15,
    "apartment furnishing": 15,
    "hotel furnishing": 15,
    "senior living": 12,
    "senior living furnishing": 18,
    "school furnishing": 18,
    "school modernization": 12,
    "dormitory": 12,
    "healthcare facility": 12,
    "university residence": 12,
    "public housing": 10,
    "building upgrade": 10,
    "facility improvement": 10,
    "renovation": 8,
    "design-build": 8,
    "government building": 8,
    "courthouse": 8,
    "library": 8,
    "community center": 8,
    "recreation center": 8,
    "window replacement": 10,
    "patient room": 12,
    "exam room": 10,
    "operating room": 8,
    "long-term care": 12,
    "assisted living": 12,
    "nursing home": 10,
    "hotel room": 10,
    "guest room": 10,
    "conference room": 8,
    "classroom": 8,
    "daycare": 8,
    "child care": 8,
}

NEGATIVE_KEYWORDS: dict[str, int] = {
    # IT / software
    "software": 25,
    "erp": 30,
    "it services": 25,
    "cyber security": 25,
    "cybersecurity": 25,
    "cloud migration": 25,
    "server": 15,
    "telecom": 20,
    "telecommunications": 20,
    "network infrastructure": 20,
    "data center": 20,
    "saas": 20,
    "microsoft": 15,
    # civil / infrastructure
    "watermain": 35,
    "water main": 35,
    "sewer": 35,
    "sanitary sewer": 35,
    "storm sewer": 35,
    "asphalt": 30,
    "road construction": 30,
    "road": 15,
    "bridge": 25,
    "bridge repair": 30,
    "concrete": 15,
    "paving": 25,
    "pothole": 30,
    "gravel": 25,
    "excavat": 20,
    "earthwork": 20,
    "culvert": 25,
    "sidewalk": 20,
    "curb and gutter": 20,
    "water treatment": 25,
    "wastewater": 30,
    "pumping station": 25,
    # mechanical / trades only
    "hvac only": 20,
    "electrical only": 20,
    "plumbing only": 20,
    "hvac": 8,
    "mechanical upgrade": 8,
    "boiler replacement": 20,
    "chiller replacement": 20,
    "elevator": 20,
    # fleet / fuel / heavy
    "heavy equipment": 25,
    "fleet services": 20,
    "fuel supply": 25,
    "diesel": 25,
    "gasoline": 20,
    "vehicles": 20,
    "snow removal": 25,
    "snow plow": 25,
    "landscaping": 20,
    "mowing": 20,
    "tree removal": 20,
    "grounds maintenance": 15,
    # professional services unrelated
    "legal services": 20,
    "audit services": 20,
    "accounting services": 20,
    "pharmacy": 25,
    "pharmaceutical": 25,
    "policing": 20,
    "fire fighting": 15,
    "ambulance": 20,
    "insurance": 15,
    "banking": 15,
    "investment": 15,
    # other unrelated
    "demolition only": 20,
    "roofing only": 15,
    "line painting": 20,
    "real estate": 15,
    "environmental assessment": 15,
    "suv": 20,
    "truck": 15,
    "medical equipment": 20,
    "laboratory equipment": 20,
    "food services": 20,
    "catering": 20,
    "janitorial": 15,
    "waste management": 20,
    "garbage": 20,
    "recycling": 15,
    # laundry services (different from textile supply)
    "laundry service": 35,
    "commercial laundry": 35,
    "industrial laundry": 35,
    "laundry equipment": 30,
    "laundry": 15,
    "dry cleaning": 30,
    "washing service": 25,
    "housekeeping": 15,
    "cleaning service": 20,
    "cleaning supplies": 20,
}

# ───────────────────────────────────────────────────────────────────────
# PRECOMPILED PATTERNS
# ───────────────────────────────────────────────────────────────────────

def _compile(d):
    """Compile keyword patterns with word boundaries to avoid false positives.

    For example, 'blind' should not match 'Blind River' (a city name).
    'ffe' should not match 'office' or 'coffee'.
    """
    compiled = []
    for kw, pts in d.items():
        escaped = re.escape(kw)
        pattern = re.compile(r"\b" + escaped + r"\b", re.IGNORECASE)
        compiled.append((kw, pts, pattern))
    return compiled

_PRIMARY = _compile(PRIMARY_KEYWORDS)
_SECONDARY = _compile(SECONDARY_KEYWORDS)
_CONTEXTUAL = _compile(CONTEXTUAL_KEYWORDS)
_NEGATIVE = _compile(NEGATIVE_KEYWORDS)

# ───────────────────────────────────────────────────────────────────────
# SEMANTIC PHRASE PATTERNS
# ───────────────────────────────────────────────────────────────────────
# Catch opportunities implying furnishing scope through compound phrases,
# even when no single keyword directly matches a product.

SEMANTIC_PATTERNS = [
    # Direct product + action
    (re.compile(r"curtain\w*\s+(replace|install|supply|procure)", re.I), 40, "curtain supply/install"),
    (re.compile(r"(replace|install|supply|procure)\w*\s+curtain", re.I), 40, "curtain supply/install"),
    (re.compile(r"blind\w*\s+(replace|install|supply|procure)", re.I), 40, "blinds supply/install"),
    (re.compile(r"(replace|install|supply|procure)\w*\s+blind", re.I), 40, "blinds supply/install"),
    (re.compile(r"shade\w*\s+(replace|install|supply|procure)", re.I), 40, "shades supply/install"),
    (re.compile(r"window\s+(covering|treatment)\w*\s+(replace|install|supply)", re.I), 45, "window covering install"),
    (re.compile(r"drap\w+\s+(replace|install|supply|hardware)", re.I), 40, "drapery supply/install"),

    # Patient/hospital/privacy combinations
    (re.compile(r"patient\s+(room\s+)?privacy\s+curtain", re.I), 50, "patient privacy curtain"),
    (re.compile(r"(hospital|medical|clinical)\s+curtain", re.I), 50, "hospital curtain"),
    (re.compile(r"privacy\s+(screen|partition|curtain|divider)", re.I), 35, "privacy divider"),
    (re.compile(r"cubicle\s+(curtain|track|rail)", re.I), 45, "cubicle curtain/track"),
    (re.compile(r"exam\s+room\s+curtain", re.I), 50, "exam room curtain"),
    (re.compile(r"(disposable|anti.?microbial|flame.?retardant)\s+curtain", re.I), 40, "specialty curtain"),

    # Facility + furnishing compound phrases
    (re.compile(r"(hotel|motel|resort)\s+.{0,30}(furnish|curtain|drape|blind|shade|window)", re.I), 35, "hospitality furnishing"),
    (re.compile(r"(hospital|healthcare|medical)\s+.{0,30}(furnish|curtain|drape|blind|shade)", re.I), 35, "healthcare furnishing"),
    (re.compile(r"(school|university|college|dormitor)\w*\s+.{0,30}(furnish|curtain|blind|shade)", re.I), 30, "education furnishing"),
    (re.compile(r"(apartment|condo|residential)\s+.{0,30}(furnish|blind|shade|curtain|window)", re.I), 30, "residential furnishing"),
    (re.compile(r"(senior|assisted)\s+(living|care)\s+.{0,30}(furnish|curtain|blind|shade)", re.I), 30, "senior care furnishing"),
    (re.compile(r"(office|commercial)\s+.{0,20}(furnish|blind|shade|window\s+treat)", re.I), 25, "commercial furnishing"),
    (re.compile(r"(military|base|barracks)\s+.{0,30}(furnish|curtain|drape|blind|shade)", re.I), 30, "military furnishing"),
    (re.compile(r"(prison|correctional|detention)\s+.{0,30}(furnish|curtain|drape|blind|shade)", re.I), 25, "correctional furnishing"),

    # Renovation + interior scope
    (re.compile(r"(interior|room)\s+(renovation|remodel|upgrade)\s+.{0,30}(furnish|finish)", re.I), 20, "interior renovation furnishing"),
    (re.compile(r"(furnish|ff&?e)\w*\s+(package|procurement|supply|contract)", re.I), 30, "furnishing procurement"),

    # Installation-specific
    (re.compile(r"(motorized|automated|electric)\s+(shade|blind|curtain|window)", re.I), 45, "motorized window products"),
    (re.compile(r"(blackout|solar|skylight)\s+(shade|blind|curtain|film)", re.I), 45, "specialty shading"),
    (re.compile(r"window\s+(film|tint)\s+(install|supply|procure)", re.I), 25, "window film"),

    # Track and hardware
    (re.compile(r"(curtain|drapery|track)\s+(track|rod|rail|hardware)", re.I), 35, "curtain hardware/track"),
    (re.compile(r"(ceiling|wall)\s+mount.{0,15}(track|rail|curtain)", re.I), 30, "mounted track system"),

    # Textile product supply
    (re.compile(r"(supply|procure|deliver)\w*\s+(blanket|bedding|towel|linen|textile)", re.I), 30, "textile supply"),
    (re.compile(r"(blanket|bedding|towel|linen|textile)\w*\s+(supply|procurement|contract|agreement)", re.I), 30, "textile supply"),
    (re.compile(r"standing\s+(agreement|offer)\s+.{0,30}(textile|linen|towel|blanket|curtain|blind|shade|window)", re.I), 35, "standing agreement textile"),
    (re.compile(r"(shutter|shutters)\s+(install|supply|replace|procure)", re.I), 40, "shutter supply/install"),
    (re.compile(r"(install|supply|replace|procure)\w*\s+(shutter|shutters)", re.I), 40, "shutter supply/install"),
    (re.compile(r"(bag|bags|tote)\s+(supply|procure|manufacture|custom)", re.I), 20, "bag supply"),
    (re.compile(r"(sock|socks|mask|masks)\s+(supply|procure|manufacture)", re.I), 20, "textile product supply"),
]

# ───────────────────────────────────────────────────────────────────────
# CATEGORY BONUS
# ───────────────────────────────────────────────────────────────────────
# If the opportunity's category field itself signals relevance.

_CATEGORY_PATTERNS = [
    (re.compile(r"window|blind|shade|curtain|drap|furnish|textile|ff&?e|interior|shutter|bedding|linen|towel", re.I), 12),
    (re.compile(r"renovation|remodel|fitout|fit-out|tenant improve|standing agreement|standing offer", re.I), 5),
]

_ORG_TYPE_BONUS = {
    "healthcare": 8,
    "housing": 8,
    "education": 5,
    "government": 3,
}

# ───────────────────────────────────────────────────────────────────────
# BUCKETS
# ───────────────────────────────────────────────────────────────────────

RELEVANCE_BUCKETS = {
    "highly_relevant": (70, 100),
    "moderately_relevant": (40, 69),
    "low_relevance": (15, 39),
    "irrelevant": (0, 14),
}


def _bucket_from_score(score):
    for bucket, (lo, hi) in RELEVANCE_BUCKETS.items():
        if lo <= score <= hi:
            return bucket
    return "irrelevant"


# ───────────────────────────────────────────────────────────────────────
# INDUSTRY TAG DERIVATION
# ───────────────────────────────────────────────────────────────────────

_TAG_RULES = [
    (re.compile(r"blind", re.I), "blinds"),
    (re.compile(r"shade|blackout|solar shade|skylight", re.I), "shades"),
    (re.compile(r"curtain|privacy curtain|cubicle curtain|hospital curtain|room divider", re.I), "curtains"),
    (re.compile(r"drape|drapery", re.I), "drapery"),
    (re.compile(r"shutter", re.I), "shutters"),
    (re.compile(r"liner", re.I), "liners"),
    (re.compile(r"window covering|window treatment", re.I), "window coverings"),
    (re.compile(r"fabric|textile|soft goods", re.I), "textiles"),
    (re.compile(r"blanket|bedding|bed linen|towel|linen", re.I), "bedding & linen"),
    (re.compile(r"\bbag\b|\btote\b", re.I), "bags"),
    (re.compile(r"\bsock\b|\bsocks\b", re.I), "socks"),
    (re.compile(r"\bmask\b|\bface mask\b", re.I), "masks"),
    (re.compile(r"standing agreement|standing offer|supply agreement", re.I), "standing agreement"),
    (re.compile(r"ff&e|ffe|furniture fixtures", re.I), "FF&E"),
    (re.compile(r"interior fit|fitout|tenant improvement", re.I), "interior fit-out"),
    (re.compile(r"motorized|automated", re.I), "motorized systems"),
    (re.compile(r"blackout", re.I), "blackout"),
    (re.compile(r"roller shade|roller blind", re.I), "roller shade"),
    (re.compile(r"hospital|healthcare|patient room|medical", re.I), "healthcare"),
    (re.compile(r"hotel|hospitality|resort|motel", re.I), "hospitality"),
    (re.compile(r"school|education|dormitor|university|college", re.I), "school"),
    (re.compile(r"senior|assisted living|nursing home|long.term care", re.I), "senior care"),
    (re.compile(r"track|rail|rod|hardware", re.I), "hardware"),
]


def _derive_tags(primary, secondary, semantic):
    tags = set()
    all_matched = " ".join(primary + secondary + semantic)
    for pattern, tag in _TAG_RULES:
        if pattern.search(all_matched):
            tags.add(tag)
    return sorted(tags)


# ───────────────────────────────────────────────────────────────────────
# BUSINESS FIT EXPLANATION GENERATOR
# ───────────────────────────────────────────────────────────────────────

def _build_explanation(
    bucket,
    primary_matches,
    secondary_matches,
    contextual_matches,
    semantic_matches,
    negative_matches,
    industry_tags,
    title_boost,
    source_fit_bonus,
    final_score,
):
    """Generate a plain-English explanation of why this opportunity scored the way it did."""

    if bucket == "irrelevant" and final_score == 0:
        if negative_matches:
            return "No window covering or furnishing keywords found. Negative signals detected: {}.".format(
                ", ".join(negative_matches[:4])
            )
        return "No window covering or furnishing relevance detected in the title or description."

    parts = []

    # Lead with the strongest signal
    if primary_matches:
        top = primary_matches[:3]
        parts.append("Direct product match: {}".format(", ".join(top)))
    if semantic_matches:
        top = semantic_matches[:2]
        parts.append("Semantic signal: {}".format(", ".join(top)))
    if secondary_matches and not primary_matches:
        top = secondary_matches[:3]
        parts.append("Textile/furnishing match: {}".format(", ".join(top)))
    elif secondary_matches:
        parts.append("Also matched: {}".format(", ".join(secondary_matches[:2])))
    if contextual_matches and not primary_matches and not secondary_matches:
        parts.append("Contextual signal: {}".format(", ".join(contextual_matches[:2])))

    if title_boost > 0:
        parts.append("Keyword found in title (strong signal)")
    if source_fit_bonus > 0:
        parts.append("Source has high industry fit")

    if negative_matches:
        parts.append("Penalized for: {}".format(", ".join(negative_matches[:3])))

    if industry_tags:
        parts.append("Tags: {}".format(", ".join(industry_tags[:5])))

    # Bucket-level summary prefix
    if bucket == "highly_relevant":
        prefix = "Strong fit for window covering business."
    elif bucket == "moderately_relevant":
        prefix = "Potential fit — review recommended."
    elif bucket == "low_relevance":
        prefix = "Weak signal — may contain relevant scope."
    else:
        prefix = "Unlikely to be relevant."

    detail = " ".join(parts)
    if detail:
        return "{} {}".format(prefix, detail)
    return prefix


# ───────────────────────────────────────────────────────────────────────
# MAIN SCORING FUNCTION
# ───────────────────────────────────────────────────────────────────────

def score_opportunity(
    title,
    description,
    org_type=None,
    project_type=None,
    category=None,
    source_fit_score=None,
):
    """Score how relevant an opportunity is to the window-covering / textile business.

    Returns (score, breakdown) where score is 0-100 and breakdown explains
    every factor including the new business_fit_explanation field.
    """
    combined = "{} {} {}".format(title or "", description or "", project_type or "")

    # Remove known false-positive location names before scoring
    _false_positives = re.compile(r"\bBlind River\b", re.I)
    scoring_text = _false_positives.sub("", combined)

    positive_score = 0
    negative_penalty = 0

    primary_matches = []
    secondary_matches = []
    contextual_matches = []
    negative_matches = []

    for kw, points, pattern in _PRIMARY:
        if pattern.search(scoring_text):
            primary_matches.append(kw)
            positive_score += points

    for kw, points, pattern in _SECONDARY:
        if pattern.search(scoring_text):
            secondary_matches.append(kw)
            positive_score += points

    for kw, points, pattern in _CONTEXTUAL:
        if pattern.search(scoring_text):
            contextual_matches.append(kw)
            positive_score += points

    # Semantic phrase-pattern matching
    semantic_matches = []
    semantic_score = 0
    for pattern, points, label in SEMANTIC_PATTERNS:
        if pattern.search(scoring_text):
            semantic_matches.append(label)
            semantic_score += points
    semantic_score = min(semantic_score, 60)
    positive_score += semantic_score

    # Org type bonus
    org_bonus = 0
    if org_type and org_type.lower() in _ORG_TYPE_BONUS:
        org_bonus = _ORG_TYPE_BONUS[org_type.lower()]
        positive_score += org_bonus

    # Source fit bonus
    source_fit_bonus = 0
    if source_fit_score is not None and source_fit_score >= 60:
        source_fit_bonus = min(10, (source_fit_score - 50) // 5)
        positive_score += source_fit_bonus

    # Category field bonus
    category_bonus = 0
    cat_text = category or ""
    for pat, bonus in _CATEGORY_PATTERNS:
        if pat.search(cat_text):
            category_bonus = max(category_bonus, bonus)
    positive_score += category_bonus

    # Negative matches
    for kw, penalty, pattern in _NEGATIVE:
        if pattern.search(scoring_text):
            negative_matches.append(kw)
            negative_penalty += penalty

    # Title boost — primary keyword in title is the strongest signal
    title_lower = (title or "").lower()
    title_boost = 0
    for kw, _, pattern in _PRIMARY:
        if pattern.search(title_lower):
            title_boost = 25
            break
    if not title_boost:
        for kw, _, pattern in _SECONDARY:
            if pattern.search(title_lower):
                title_boost = 15
                break

    positive_score += title_boost

    # Apply negative penalty — much harder if no positive matches
    if negative_matches:
        if not primary_matches and not secondary_matches:
            negative_penalty = max(negative_penalty, 50)
        elif not primary_matches:
            negative_penalty = int(negative_penalty * 0.8)
        else:
            negative_penalty = int(negative_penalty * 0.3)

    raw_score = positive_score - negative_penalty
    final_score = max(0, min(100, raw_score))

    bucket = _bucket_from_score(final_score)
    industry_tags = _derive_tags(primary_matches, secondary_matches, semantic_matches)

    explanation = _build_explanation(
        bucket=bucket,
        primary_matches=primary_matches,
        secondary_matches=secondary_matches,
        contextual_matches=contextual_matches,
        semantic_matches=semantic_matches,
        negative_matches=negative_matches,
        industry_tags=industry_tags,
        title_boost=title_boost,
        source_fit_bonus=source_fit_bonus,
        final_score=final_score,
    )

    breakdown = {
        "primary_matches": primary_matches,
        "secondary_matches": secondary_matches,
        "contextual_matches": contextual_matches,
        "semantic_matches": semantic_matches,
        "negative_matches": negative_matches,
        "industry_tags": industry_tags,
        "org_bonus": org_bonus,
        "source_fit_bonus": source_fit_bonus,
        "category_bonus": category_bonus,
        "title_boost": title_boost,
        "semantic_score": semantic_score,
        "positive_score": positive_score,
        "negative_penalty": negative_penalty,
        "final_score": final_score,
        "relevance_bucket": bucket,
        "business_fit_explanation": explanation,
    }

    return final_score, breakdown
