"""Google Translate integration for opportunity content translation."""

from __future__ import annotations

from datetime import datetime, timezone

import requests
from sqlalchemy import text
from sqlalchemy.orm import Session

from src.core.config import settings
from src.core.logging import get_logger

logger = get_logger(__name__)

_TRANSLATE_URL = "https://translation.googleapis.com/language/translate/v2"
_MAX_CHARS_PER_REQUEST = 5000


def translate_to_zh(content: str) -> str | None:
    """Translate a text string to Simplified Chinese via Google Translate REST API.

    Returns None on failure so callers can fall back gracefully.
    """
    if not content or not content.strip():
        return None
    if not settings.GOOGLE_TRANSLATE_API_KEY:
        logger.warning("GOOGLE_TRANSLATE_API_KEY not set — skipping translation")
        return None

    truncated = content[:_MAX_CHARS_PER_REQUEST]
    try:
        resp = requests.post(
            _TRANSLATE_URL,
            params={"key": settings.GOOGLE_TRANSLATE_API_KEY},
            json={
                "q": truncated,
                "source": "en",
                "target": "zh-CN",
                "format": "text",
            },
            timeout=15,
        )
        resp.raise_for_status()
        data = resp.json()
        return data["data"]["translations"][0]["translatedText"]
    except Exception:
        logger.exception("Google Translate API call failed")
        return None


def translate_opportunity_fields(session: Session, opp_id: str) -> bool:
    """Translate title, description_summary, description_full for one opportunity.

    Only called for opportunities with relevance_score >= 80.
    Returns True if translation was written, False otherwise.
    """
    row = session.execute(
        text(
            "SELECT title, description_summary, description_full "
            "FROM opportunities WHERE id = :id"
        ),
        {"id": opp_id},
    ).fetchone()

    if not row:
        return False

    title_zh = translate_to_zh(row.title) if row.title else None
    summary_zh = translate_to_zh(row.description_summary) if row.description_summary else None
    full_zh = translate_to_zh(row.description_full) if row.description_full else None

    if not title_zh and not summary_zh and not full_zh:
        return False

    session.execute(
        text("""
            UPDATE opportunities SET
                title_zh = COALESCE(:title_zh, title_zh),
                description_summary_zh = COALESCE(:summary_zh, description_summary_zh),
                description_full_zh = COALESCE(:full_zh, description_full_zh),
                translated_at = :now,
                updated_at = NOW()
            WHERE id = :id
        """),
        {
            "id": opp_id,
            "title_zh": title_zh,
            "summary_zh": summary_zh,
            "full_zh": full_zh,
            "now": datetime.now(timezone.utc),
        },
    )
    session.flush()
    logger.info("Translated opportunity %s", opp_id)
    return True


def translate_pending_batch(session: Session, limit: int = 50) -> int:
    """Find high-relevance opportunities without translations and translate them.

    Returns the count of newly translated opportunities.
    """
    rows = session.execute(
        text("""
            SELECT id FROM opportunities
            WHERE relevance_score >= 80
              AND title_zh IS NULL
            ORDER BY created_at DESC
            LIMIT :lim
        """),
        {"lim": limit},
    ).fetchall()

    if not rows:
        logger.info("No pending translations found")
        return 0

    translated = 0
    for row in rows:
        try:
            if translate_opportunity_fields(session, str(row.id)):
                translated += 1
        except Exception:
            logger.exception("Failed to translate opportunity %s", row.id)

    session.commit()
    logger.info("Batch translation complete: %d/%d translated", translated, len(rows))
    return translated
