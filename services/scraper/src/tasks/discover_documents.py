"""Document discovery — find and register document links from source websites.

Before AI deep analysis, this module scrapes the original tender detail page
to discover PDF/DOCX attachment links that weren't captured during the initial
crawl.  Each source platform has a tailored strategy; a generic fallback
extracts any document-like links from the page HTML.

Supported strategies:
  - CanadaBuys: scrape notice page for "Bidding details" PDF links (public)
  - Biddingo: scrape bid detail page for document links
  - SaskTenders: scrape detail page for document links
  - Generic: extract .pdf/.docx/.doc/.xls/.xlsx links from source_url
  - Skip: SAM.gov, Nova Scotia (already captured), MERX (auth required)
"""

from __future__ import annotations

from typing import Any
from urllib.parse import urljoin

import requests as http_requests
from sqlalchemy import text

from src.core.logging import get_logger
from src.tasks.celery_app import celery_app

logger = get_logger(__name__)

_TIMEOUT = 45
_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
_DOC_EXTENSIONS = (".pdf", ".docx", ".doc", ".xls", ".xlsx", ".csv", ".zip", ".txt")

_SKIP_SOURCES = {
    "sam.gov",
    "nova scotia",
    "merx",
    "bc bid",
    "toronto bids",
    "bids and tenders",
    "bidnet direct",
}


def _get_soup(url: str):
    """Fetch a URL and return a BeautifulSoup object."""
    from bs4 import BeautifulSoup
    resp = http_requests.get(url, timeout=_TIMEOUT, headers={
        "User-Agent": _USER_AGENT,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    })
    resp.raise_for_status()
    return BeautifulSoup(resp.text, "lxml"), resp.url


def _extract_doc_links_from_html(soup, base_url: str) -> list[dict[str, str]]:
    """Extract all document-like links from an HTML page."""
    docs: list[dict[str, str]] = []
    seen_urls: set[str] = set()

    for a_tag in soup.find_all("a", href=True):
        href = a_tag["href"].strip()
        lower_href = href.lower()

        is_doc = any(ext in lower_href for ext in _DOC_EXTENSIONS)
        if not is_doc:
            continue

        url = href if href.startswith("http") else urljoin(base_url, href)
        if url in seen_urls:
            continue
        seen_urls.add(url)

        title = (a_tag.get_text(strip=True) or "").strip()
        if not title or len(title) < 3:
            title = url.rsplit("/", 1)[-1]

        file_type = ""
        for ext in _DOC_EXTENSIONS:
            if ext in lower_href:
                file_type = ext.lstrip(".")
                break

        docs.append({
            "title": title[:250],
            "url": url,
            "file_type": file_type or "file",
        })

    return docs


# ──────────────────────────────────────────────────────────────
# Source-specific strategies
# ──────────────────────────────────────────────────────────────

def _discover_canadabuys(opp_row: Any, session: Any) -> list[dict[str, str]]:
    """Discover documents from a CanadaBuys tender detail page.

    The CSV feed only provides notice_url, which may point to the CanadaBuys
    detail page or MERX.  We try:
    1. raw_data.notice_url (the original notice URL from CSV)
    2. source_url (our constructed URL)
    """
    raw = opp_row.raw_data or {}
    if isinstance(raw, str):
        import json
        try:
            raw = json.loads(raw)
        except Exception:
            raw = {}

    urls_to_try = []

    notice_url = raw.get("notice_url", "")
    if notice_url and "canadabuys" in notice_url.lower():
        urls_to_try.append(notice_url)

    if opp_row.source_url and "canadabuys" in opp_row.source_url.lower():
        if opp_row.source_url not in urls_to_try:
            urls_to_try.append(opp_row.source_url)

    sol_number = opp_row.solicitation_number or raw.get("reference_number", "")
    if sol_number:
        search_url = f"https://canadabuys.canada.ca/en/tender-opportunities?keyword={sol_number}"
        urls_to_try.append(search_url)

    all_docs: list[dict[str, str]] = []
    seen_urls: set[str] = set()

    for url in urls_to_try:
        try:
            soup, final_url = _get_soup(url)

            if "tender-notice" in final_url or "tender-opportunities" in final_url:
                docs = _extract_doc_links_from_html(soup, final_url)
                pdf_docs = [d for d in docs if d["file_type"] in ("pdf", "docx", "doc", "xlsx", "xls")]
                for d in pdf_docs:
                    if d["url"] not in seen_urls:
                        seen_urls.add(d["url"])
                        all_docs.append(d)

            if all_docs:
                break

        except Exception as exc:
            logger.debug("CanadaBuys page fetch failed for %s: %s", url[:80], exc)
            continue

    return all_docs


def _discover_biddingo(opp_row: Any, session: Any) -> list[dict[str, str]]:
    """Discover documents from a Biddingo bid detail page.

    Biddingo is a paid platform; document download links may require auth.
    We attempt to extract links from the public-facing bid page.
    """
    source_url = opp_row.source_url
    if not source_url or "biddingo" not in source_url.lower():
        return []

    try:
        soup, final_url = _get_soup(source_url)
        return _extract_doc_links_from_html(soup, final_url)
    except Exception as exc:
        logger.debug("Biddingo page fetch failed for %s: %s", source_url[:80], exc)
        return []


def _discover_sasktenders(opp_row: Any, session: Any) -> list[dict[str, str]]:
    """Discover documents from a SaskTenders detail page."""
    source_url = opp_row.source_url
    if not source_url or "sasktenders" not in source_url.lower():
        return []

    try:
        soup, final_url = _get_soup(source_url)
        return _extract_doc_links_from_html(soup, final_url)
    except Exception as exc:
        logger.debug("SaskTenders page fetch failed for %s: %s", source_url[:80], exc)
        return []


def _discover_generic(opp_row: Any, session: Any) -> list[dict[str, str]]:
    """Generic fallback: scrape source_url for any document links."""
    source_url = opp_row.source_url
    if not source_url:
        return []

    skip_domains = ["sam.gov", "merx.com"]
    if any(d in source_url.lower() for d in skip_domains):
        return []

    try:
        soup, final_url = _get_soup(source_url)
        return _extract_doc_links_from_html(soup, final_url)
    except Exception as exc:
        logger.debug("Generic document discovery failed for %s: %s", source_url[:80], exc)
        return []


# ──────────────────────────────────────────────────────────────
# Strategy dispatch
# ──────────────────────────────────────────────────────────────

_STRATEGY_MAP: dict[str, Any] = {
    "canadabuys": _discover_canadabuys,
    "biddingo": _discover_biddingo,
    "sasktenders": _discover_sasktenders,
}


def _select_strategy(source_name: str):
    """Select the best discovery strategy based on source name."""
    name_lower = source_name.lower()

    for skip in _SKIP_SOURCES:
        if skip in name_lower:
            return None

    for key, func in _STRATEGY_MAP.items():
        if key in name_lower:
            return func

    return _discover_generic


# ──────────────────────────────────────────────────────────────
# Core discovery function (callable synchronously)
# ──────────────────────────────────────────────────────────────

def discover_documents_for_opportunity_sync(session: Any, opportunity_id: str) -> int:
    """Discover and register documents for an opportunity. Returns count of new docs."""
    existing_count = session.execute(
        text("""
            SELECT COUNT(*) as cnt FROM opportunity_documents
            WHERE opportunity_id = :opp_id
              AND LOWER(file_type) IN ('pdf', 'docx', 'doc', 'xlsx', 'xls')
        """),
        {"opp_id": opportunity_id},
    ).fetchone()

    if existing_count and existing_count.cnt > 0:
        logger.debug("Opportunity %s already has %d documents — skipping discovery",
                      opportunity_id, existing_count.cnt)
        return 0

    opp = session.execute(
        text("""
            SELECT o.id, o.source_url, o.solicitation_number, o.raw_data, o.has_documents,
                   s.name as source_name
            FROM opportunities o
            LEFT JOIN sources s ON o.source_id = s.id
            WHERE o.id = :id
        """),
        {"id": opportunity_id},
    ).fetchone()

    if not opp:
        logger.warning("Opportunity %s not found for document discovery", opportunity_id)
        return 0

    source_name = opp.source_name or ""
    strategy = _select_strategy(source_name)
    if strategy is None:
        logger.debug("Skipping document discovery for source '%s' (has own capture)", source_name)
        return 0

    logger.info("Discovering documents for opp=%s source='%s' strategy=%s",
                opportunity_id, source_name, strategy.__name__)

    try:
        docs = strategy(opp, session)
    except Exception as exc:
        logger.warning("Document discovery failed for %s: %s", opportunity_id, exc)
        return 0

    if not docs:
        logger.info("No documents discovered for %s", opportunity_id)
        return 0

    inserted = 0
    for doc in docs:
        url = doc.get("url", "")
        if not url:
            continue

        existing = session.execute(
            text("SELECT id FROM opportunity_documents WHERE opportunity_id = :oid AND url = :url LIMIT 1"),
            {"oid": opportunity_id, "url": url},
        ).fetchone()
        if existing:
            continue

        try:
            session.execute(
                text("""
                    INSERT INTO opportunity_documents (
                        opportunity_id, title, url, file_type, doc_category
                    ) VALUES (:oid, :title, :url, :ft, 'source_attachment')
                """),
                {
                    "oid": opportunity_id,
                    "title": doc.get("title", "")[:250],
                    "url": url,
                    "ft": doc.get("file_type", "")[:50],
                },
            )
            inserted += 1
        except Exception as exc:
            logger.debug("Failed to insert discovered doc for %s: %s", opportunity_id, exc)

    if inserted > 0:
        session.execute(
            text("UPDATE opportunities SET has_documents = true WHERE id = :id"),
            {"id": opportunity_id},
        )
        session.commit()
        logger.info("Discovered and registered %d documents for %s", inserted, opportunity_id)

    return inserted


# ──────────────────────────────────────────────────────────────
# Celery task wrapper
# ──────────────────────────────────────────────────────────────

@celery_app.task(
    name="src.tasks.discover_documents.discover_documents_for_opportunity",
    bind=True,
    max_retries=1,
    default_retry_delay=30,
    soft_time_limit=120,
    time_limit=150,
)
def discover_documents_for_opportunity(self: Any, opportunity_id: str) -> dict[str, Any]:
    """Celery task: discover documents for an opportunity."""
    from src.core.database import get_db_session
    session = get_db_session()
    try:
        count = discover_documents_for_opportunity_sync(session, opportunity_id)
        return {"status": "ok", "opportunity_id": opportunity_id, "documents_found": count}
    except Exception as exc:
        session.rollback()
        logger.exception("Document discovery task failed for %s", opportunity_id)
        try:
            self.retry(exc=exc)
        except self.MaxRetriesExceededError:
            pass
        return {"status": "error", "reason": str(exc)}
    finally:
        session.close()
