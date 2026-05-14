"""Regression tests for the new supply/delivery keyword phrases.

Confirms two things:

1. Each new phrase is registered in ``SECONDARY_KEYWORDS`` with a
   sensible weight (so we never silently drop one in a future edit).
2. Each phrase actually matches inside realistic procurement text —
   including punctuation variants like ``&`` ``/`` and commas, which
   were the highest-risk part of this change because the scorer uses
   ``\\b...\\b`` word boundaries.

Also documents the explicit decision around ``supplement and deliver``:
the team confirmed it was a typo for ``supply and deliver`` and we
intentionally do NOT add it. This test guards against accidental
re-introduction.
"""

from __future__ import annotations

import pytest

from src.utils.scorer import SECONDARY_KEYWORDS, score_opportunity

# Phrases the team asked for. Order is deliberate: first three are also
# pushed into crawler discovery layer (_SEARCH_KEYWORDS); the rest are
# scoring-only.
NEW_SUPPLY_PHRASES = [
    "supply and delivery",
    "supply & delivery",
    "supply and deliver",
    "supplying and delivering",
    "supply / delivery",
    "supply and delivered",
    "supply, delivery and installation",
    "supply and install",
    "supply, deliver and install",
]

# Realistic procurement title/description snippets where the phrase
# would actually appear. These mirror real RFP/RFQ language so we
# catch tokenization regressions, not just trivial substring matches.
REALISTIC_TEXT_FOR_PHRASE = {
    "supply and delivery": "RFP for the supply and delivery of office furniture to City Hall",
    "supply & delivery": "Tender notice — supply & delivery of cleaning supplies, three-year contract",
    "supply and deliver": "Vendor must supply and deliver all materials to the project site",
    "supplying and delivering": "Standing offer for supplying and delivering linen to regional hospitals",
    "supply / delivery": "Scope of work: supply / delivery of replacement window blinds",
    "supply and delivered": "Goods to be supply and delivered within 30 days of award",
    "supply, delivery and installation": "Supply, delivery and installation of motorized roller shades",
    "supply and install": "Contract to supply and install hospital privacy curtains across two wings",
    "supply, deliver and install": "Contractor will supply, deliver and install the cubicle curtain tracks",
}


def test_all_new_phrases_registered_in_secondary_keywords():
    """Every requested phrase must exist as a SECONDARY keyword with a positive weight."""
    missing = [p for p in NEW_SUPPLY_PHRASES if p not in SECONDARY_KEYWORDS]
    assert not missing, (
        f"Expected new supply/delivery phrases to be registered in "
        f"SECONDARY_KEYWORDS but missing: {missing}"
    )
    for phrase in NEW_SUPPLY_PHRASES:
        weight = SECONDARY_KEYWORDS[phrase]
        assert 10 <= weight <= 30, (
            f"Weight for {phrase!r} is {weight}; expected 10-30 to match the "
            f"surrounding 'supply agreement / standing offer' tier."
        )


def test_supplement_and_deliver_is_intentionally_excluded():
    """Team confirmed this was a typo; document and lock it in.

    If the business later confirms they really meant ``supplement`` (i.e.
    augmentation of an existing contract), update this test and add the
    phrase with a low weight. Until then, silently dropping it would be
    a product bug, so the test asserts the explicit decision.
    """
    assert "supplement and deliver" not in SECONDARY_KEYWORDS, (
        "'supplement and deliver' was confirmed as a typo for 'supply "
        "and deliver' and intentionally not added. If this changes, "
        "update test_scorer_keywords.py and the keyword dictionary "
        "together."
    )


@pytest.mark.parametrize("phrase", NEW_SUPPLY_PHRASES)
def test_phrase_matches_in_realistic_title(phrase):
    """Each phrase scores >0 when present in a realistic title.

    Title-only run with no description; this is the harshest case
    because the scorer's title-boost path runs against ``title.lower()``
    independently of the combined-text matcher.
    """
    title = REALISTIC_TEXT_FOR_PHRASE[phrase]
    score, breakdown = score_opportunity(title=title, description="")
    assert score > 0, (
        f"Title containing {phrase!r} scored 0 — phrase is not being "
        f"detected. Breakdown: {breakdown}"
    )
    secondary = breakdown.get("secondary_matches", [])
    assert phrase in secondary, (
        f"Phrase {phrase!r} not in secondary_matches={secondary}. "
        f"Likely a word-boundary issue with punctuation."
    )


@pytest.mark.parametrize("phrase", NEW_SUPPLY_PHRASES)
def test_phrase_matches_in_realistic_description(phrase):
    """Each phrase also matches when only present in description body."""
    description = REALISTIC_TEXT_FOR_PHRASE[phrase]
    # Generic non-matching title to isolate the description path
    score, breakdown = score_opportunity(
        title="Notice of contract award",
        description=description,
    )
    secondary = breakdown.get("secondary_matches", [])
    assert phrase in secondary, (
        f"Phrase {phrase!r} not detected when present in description. "
        f"secondary_matches={secondary}"
    )


def test_punctuation_variants_dont_false_match():
    """Word-boundary regression: ``supply & delivery`` should not match
    on ``supply and delivery`` and vice versa.

    The variants are distinct registered phrases, so each should match
    only the corresponding form. This protects against an over-eager
    regex change later that collapses them.
    """
    score, breakdown = score_opportunity(
        title="supply and delivery of paper",
        description="",
    )
    matches = set(breakdown.get("secondary_matches", []))
    assert "supply and delivery" in matches
    # Ampersand variant should NOT match the "and" form
    assert "supply & delivery" not in matches


def test_combined_score_lifts_into_relevant_bucket_with_product_word():
    """A real BidToGo-shaped title combining a primary product word with
    one of the new phrases should land in moderately/highly relevant.
    Guards against a regression where the new phrases somehow demote
    scoring (e.g. by being mis-registered as negative)."""
    score, breakdown = score_opportunity(
        title="Supply and delivery of motorized roller shades for Toronto hospital",
        description="Replacement window coverings for patient rooms.",
        country="CA",
    )
    assert score >= 70, (
        f"Combined product + supply phrase scored only {score}. "
        f"Breakdown: {breakdown}"
    )
    assert breakdown["relevance_bucket"] in {"highly_relevant", "moderately_relevant"}
