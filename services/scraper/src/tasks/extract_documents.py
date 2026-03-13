"""Document text extraction task.

Downloads opportunity documents (PDF, DOCX) and extracts text content,
storing the result in opportunity_documents.extracted_text for use
in AI Tender Intelligence analysis.
"""

from __future__ import annotations

import io
import tempfile
from pathlib import Path

import requests
from celery import shared_task
from sqlalchemy import text

from src.core.database import get_db_session
from src.core.logging import get_logger

logger = get_logger(__name__)

_SUPPORTED_TYPES = {"pdf", "docx", "doc", "txt"}
_MAX_FILE_SIZE = 20 * 1024 * 1024  # 20 MB
_DOWNLOAD_TIMEOUT = 60


def _extract_pdf(content: bytes) -> str:
    from pypdf import PdfReader
    reader = PdfReader(io.BytesIO(content))
    parts: list[str] = []
    for page in reader.pages:
        page_text = page.extract_text()
        if page_text:
            parts.append(page_text)
    return "\n\n".join(parts)


def _extract_docx(content: bytes) -> str:
    from docx import Document
    with tempfile.NamedTemporaryFile(suffix=".docx", delete=False) as tmp:
        tmp.write(content)
        tmp_path = Path(tmp.name)
    try:
        doc = Document(str(tmp_path))
        return "\n\n".join(p.text for p in doc.paragraphs if p.text.strip())
    finally:
        tmp_path.unlink(missing_ok=True)


def _extract_txt(content: bytes) -> str:
    return content.decode("utf-8", errors="replace")


_EXTRACTORS = {
    "pdf": _extract_pdf,
    "docx": _extract_docx,
    "doc": _extract_docx,
    "txt": _extract_txt,
}


@shared_task(name="src.tasks.extract_documents.extract_opportunity_documents", bind=True, max_retries=2)
def extract_opportunity_documents(self, opportunity_id: str) -> dict:
    """Download and extract text from all documents for an opportunity."""
    session = get_db_session()
    try:
        docs = session.execute(
            text("""
                SELECT id, title, url, file_type
                FROM opportunity_documents
                WHERE opportunity_id = :opp_id
                  AND (text_extracted = false OR extracted_text IS NULL)
                  AND url IS NOT NULL AND url != ''
                ORDER BY created_at
            """),
            {"opp_id": opportunity_id},
        ).fetchall()

        if not docs:
            return {"opportunity_id": opportunity_id, "extracted": 0, "skipped": 0, "failed": 0}

        extracted = 0
        skipped = 0
        failed = 0

        for doc in docs:
            file_type = (doc.file_type or "").lower().strip(".")
            if file_type not in _SUPPORTED_TYPES:
                logger.debug("Skipping unsupported file type '%s' for doc %s", file_type, doc.id)
                skipped += 1
                continue

            try:
                resp = requests.get(doc.url, timeout=_DOWNLOAD_TIMEOUT, stream=True)
                resp.raise_for_status()

                content_length = int(resp.headers.get("content-length", 0))
                if content_length > _MAX_FILE_SIZE:
                    logger.warning("Document %s too large (%d bytes), skipping", doc.id, content_length)
                    skipped += 1
                    continue

                content = resp.content
                if len(content) > _MAX_FILE_SIZE:
                    logger.warning("Document %s too large (%d bytes after download), skipping", doc.id, len(content))
                    skipped += 1
                    continue

                extractor = _EXTRACTORS.get(file_type)
                if not extractor:
                    skipped += 1
                    continue

                text_content = extractor(content)

                if not text_content or len(text_content.strip()) < 10:
                    logger.info("Document %s extracted but no meaningful text (likely scanned/image PDF)", doc.id)
                    session.execute(
                        text("UPDATE opportunity_documents SET text_extracted = true WHERE id = :id"),
                        {"id": doc.id},
                    )
                    session.commit()
                    skipped += 1
                    continue

                text_content = text_content[:200000]

                session.execute(
                    text("""
                        UPDATE opportunity_documents SET
                            extracted_text = :extracted_text,
                            text_extracted = true,
                            page_count = :page_count
                        WHERE id = :id
                    """),
                    {
                        "id": doc.id,
                        "extracted_text": text_content,
                        "page_count": text_content.count("\n\n") + 1,
                    },
                )
                session.commit()
                extracted += 1
                logger.info(
                    "Extracted %d chars from document '%s' (%s) for opportunity %s",
                    len(text_content), doc.title or doc.id, file_type, opportunity_id,
                )

            except requests.RequestException as exc:
                logger.warning("Failed to download document %s: %s", doc.id, exc)
                failed += 1
            except Exception as exc:
                logger.error("Failed to extract text from document %s: %s", doc.id, exc)
                failed += 1

        result = {
            "opportunity_id": opportunity_id,
            "extracted": extracted,
            "skipped": skipped,
            "failed": failed,
        }
        logger.info("Document extraction complete: %s", result)
        return result

    except Exception as exc:
        session.rollback()
        logger.exception("extract_opportunity_documents failed for %s", opportunity_id)
        raise self.retry(exc=exc, countdown=30)
    finally:
        session.close()


@shared_task(name="src.tasks.extract_documents.extract_pending_documents")
def extract_pending_documents() -> dict:
    """Find all opportunities with un-extracted documents and process them."""
    session = get_db_session()
    try:
        rows = session.execute(
            text("""
                        SELECT DISTINCT opportunity_id
                        FROM opportunity_documents
                        WHERE text_extracted = false
                          AND url IS NOT NULL AND url != ''
                          AND LOWER(file_type) IN ('pdf', 'docx', 'doc', 'txt')
                        LIMIT 50
            """),
        ).fetchall()

        for row in rows:
            extract_opportunity_documents.delay(str(row.opportunity_id))

        return {"queued": len(rows)}
    finally:
        session.close()
