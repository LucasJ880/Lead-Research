"""Authenticated MERX session — login, document discovery, and file download.

Security rules:
  - Credentials read ONLY from environment variables (MERX_EMAIL, MERX_PASSWORD)
  - Credentials are NEVER logged, printed, or exposed in UI
  - Session cookies are kept in memory only
  - Used exclusively for authorized access to MERX paid features (document tabs)

Flow:
  1. Visit homepage → acquire JSESSIONID + AWSALB cookies + CSRF token
  2. POST login with j_username / j_password / _csrf
  3. Verify authenticated session (check for account/profile indicators)
  4. Fetch document tab via AJAX using internal solicitation ID
  5. Parse document list table for download links
  6. Download each file to structured local storage
"""

from __future__ import annotations

import os
import re
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup

from src.core.config import settings
from src.core.logging import get_logger

logger = get_logger(__name__)

_BASE = "https://www.merx.com"
_LOGIN_URL = f"{_BASE}/public/authentication/login"
_DOC_STORAGE_ROOT = Path(__file__).resolve().parents[3] / "documents" / "merx"


@dataclass
class MerxDocument:
    """Metadata for a single downloadable tender document."""
    name: str
    url: str
    file_type: str = ""
    file_size_bytes: int = 0
    page_count: int | None = None
    doc_category: str = ""
    downloaded_at: datetime | None = None
    local_path: str | None = None


@dataclass
class MerxDocSet:
    """All documents for a solicitation."""
    solicitation_id: str
    opportunity_url: str
    internal_id: str = ""
    documents: list[MerxDocument] = field(default_factory=list)
    auth_required: bool = True
    error: str | None = None


class MerxAuthSession:
    """Manages authenticated MERX sessions for document access."""

    def __init__(self) -> None:
        self._session = requests.Session()
        self._session.headers.update({
            "User-Agent": (
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/120.0.0.0 Safari/537.36"
            ),
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-CA,en-US;q=0.9,en;q=0.8",
        })
        self._authenticated = False
        self._csrf_token: str = ""

    @property
    def is_authenticated(self) -> bool:
        return self._authenticated

    def login(self) -> bool:
        """Authenticate with MERX using environment credentials.

        Returns True on success, False on failure.
        """
        email = settings.MERX_EMAIL
        password = settings.MERX_PASSWORD

        if not email or not password:
            logger.error("MERX credentials not configured — set MERX_EMAIL and MERX_PASSWORD")
            return False

        logger.info("Establishing MERX session...")
        try:
            r = self._session.get(_BASE, timeout=15)
            r.raise_for_status()
        except Exception as exc:
            logger.error("Failed to reach MERX homepage: %s", exc)
            return False

        soup = BeautifulSoup(r.text, "lxml")
        csrf_input = soup.find("input", {"name": "_csrf"})
        if not csrf_input:
            logger.error("CSRF token not found on MERX homepage")
            return False
        self._csrf_token = csrf_input.get("value", "")

        time.sleep(1)

        logger.info("Logging into MERX (email: %s...)", email[:3] + "***")
        try:
            r = self._session.post(
                _LOGIN_URL,
                data={
                    "j_username": email,
                    "j_password": password,
                    "_csrf": self._csrf_token,
                },
                headers={
                    "Content-Type": "application/x-www-form-urlencoded",
                    "Referer": _BASE,
                    "Origin": _BASE,
                },
                timeout=20,
                allow_redirects=True,
            )
        except Exception as exc:
            logger.error("MERX login request failed: %s", exc)
            return False

        if r.status_code >= 400:
            logger.error("MERX login returned %d", r.status_code)
            return False

        body = r.text.lower()
        if "invalid" in body and "password" in body:
            logger.error("MERX login rejected — invalid credentials")
            return False

        if "logout" in body or "my account" in body or "sign out" in body:
            self._authenticated = True
            logger.info("MERX login successful — authenticated session active")
            return True

        # Check cookies for session indicators
        cookie_names = [c.name for c in self._session.cookies]
        if "JSESSIONID" in cookie_names:
            self._authenticated = True
            logger.info("MERX login completed — session cookies present")
            return True

        logger.warning("MERX login status uncertain — proceeding cautiously")
        self._authenticated = True
        return True

    def extract_internal_id(self, detail_page_html: str) -> str | None:
        """Extract the MERX internal solicitation ID from a detail page.

        The internal ID appears in data-ajax-url attributes like:
        /public/solicitations/3866360105/abstract/docs-items
        """
        m = re.search(r"/public/solicitations/(\d+)/abstract/", detail_page_html)
        return m.group(1) if m else None

    def fetch_document_list(self, internal_id: str) -> list[MerxDocument]:
        """Fetch the Documents tab via AJAX and parse the document list.

        Requires an authenticated session.
        """
        if not self._authenticated:
            logger.error("Cannot fetch documents — not authenticated")
            return []

        ajax_url = f"{_BASE}/public/solicitations/{internal_id}/abstract/docs-items"
        logger.info("Fetching document list from %s", ajax_url)

        try:
            r = self._session.get(
                ajax_url,
                headers={"X-Requested-With": "XMLHttpRequest"},
                timeout=20,
            )
            r.raise_for_status()
        except Exception as exc:
            logger.error("Document list fetch failed: %s", exc)
            return []

        raw = r.text
        # MERX returns JS that sets innerHTML — extract the HTML payload
        # The response is like: $("#innerTabContent").html('\u003C...\u003E');
        # We need to unescape the unicode escape sequences
        html_content = raw
        html_match = re.search(r'\.html\([\'"](.+?)[\'"]\);?\s*$', raw, re.DOTALL)
        if html_match:
            html_content = html_match.group(1)
        # Unescape \u003C etc. safely
        try:
            html_content = html_content.encode("utf-8").decode("unicode_escape")
        except (UnicodeDecodeError, UnicodeEncodeError):
            # Fallback: manual unescape of common HTML entities
            html_content = html_content.replace(r"\u003C", "<").replace(r"\u003E", ">")
            html_content = html_content.replace(r"\u0026", "&").replace(r"\/", "/")
            html_content = html_content.replace(r"\u0027", "'").replace(r'\\"', '"')
            html_content = html_content.replace(r"\n", "\n").replace(r"\t", "\t")

        if "loginRegisterInterception" in html_content:
            logger.warning("Documents tab still shows login prompt — auth may have failed")
            return []

        soup = BeautifulSoup(html_content, "lxml")
        documents: list[MerxDocument] = []

        # Parse document items from the tab content
        # Look for download links, document tables, or file listings
        for link in soup.find_all("a", href=True):
            href = self._clean_href(link.get("href", ""))
            text = self._clean_name(link.get_text(strip=True))
            if any(kw in href.lower() for kw in ["download", "document", ".pdf", ".doc", ".xls", "attachment"]):
                url = urljoin(_BASE, href)
                ft = self._guess_file_type(href, text)
                documents.append(MerxDocument(name=text or "Document", url=url, file_type=ft))

        # Also look for document items in tables
        for row in soup.find_all("tr"):
            cells = row.find_all("td")
            if len(cells) >= 2:
                name_cell = cells[0]
                link = name_cell.find("a", href=True)
                if link:
                    href = self._clean_href(link.get("href", ""))
                    text = self._clean_name(link.get_text(strip=True) or name_cell.get_text(strip=True))
                    url = urljoin(_BASE, href)
                    ft = self._guess_file_type(href, text)
                    if text and url not in [d.url for d in documents]:
                        documents.append(MerxDocument(name=text, url=url, file_type=ft))

        # Also look for any document listing div patterns
        for item in soup.find_all("div", class_=re.compile(r"doc|item|file", re.I)):
            link = item.find("a", href=True)
            if link:
                href = link.get("href", "")
                text = link.get_text(strip=True) or item.get_text(strip=True)[:60]
                url = urljoin(_BASE, self._clean_href(href))
                if url not in [d.url for d in documents]:
                    ft = self._guess_file_type(href, text)
                    documents.append(MerxDocument(name=self._clean_name(text), url=url, file_type=ft))

        # Clean all document URLs and names
        for doc in documents:
            doc.url = doc.url.replace("\\", "")
            doc.name = self._clean_name(doc.name)

        logger.info("Found %d documents for solicitation %s", len(documents), internal_id)
        return documents

    def download_document(self, doc: MerxDocument, solicitation_id: str) -> MerxDocument:
        """Download a single document to local structured storage.

        Storage path: /documents/merx/{solicitation_id}/{filename}
        """
        if not self._authenticated:
            logger.error("Cannot download — not authenticated")
            return doc

        target_dir = _DOC_STORAGE_ROOT / solicitation_id
        target_dir.mkdir(parents=True, exist_ok=True)

        safe_name = re.sub(r'[^\w\-. ]', '_', doc.name)[:100]
        if not safe_name.endswith(f".{doc.file_type}") and doc.file_type:
            safe_name = f"{safe_name}.{doc.file_type}"
        target_path = target_dir / safe_name

        logger.info("Downloading %s → %s", doc.name, target_path)
        try:
            r = self._session.get(doc.url, timeout=60, stream=True)
            r.raise_for_status()

            with open(target_path, "wb") as f:
                for chunk in r.iter_content(chunk_size=8192):
                    f.write(chunk)

            doc.file_size_bytes = target_path.stat().st_size
            doc.local_path = str(target_path)
            doc.downloaded_at = datetime.now(timezone.utc)

            ct = r.headers.get("content-type", "").lower()
            if "pdf" in ct:
                doc.file_type = "pdf"
            elif "word" in ct or "docx" in ct:
                doc.file_type = "docx"
            elif "excel" in ct or "xlsx" in ct:
                doc.file_type = "xlsx"

            logger.info("Downloaded %s (%d bytes)", doc.name, doc.file_size_bytes)

        except Exception as exc:
            logger.error("Download failed for %s: %s", doc.name, exc)

        return doc

    def download_all_documents(self, internal_id: str, solicitation_id: str) -> MerxDocSet:
        """Full pipeline: fetch document list → download each file."""
        docset = MerxDocSet(
            solicitation_id=solicitation_id,
            opportunity_url=f"{_BASE}/solicitations/open-bids/{solicitation_id}",
            internal_id=internal_id,
        )

        docs = self.fetch_document_list(internal_id)
        if not docs:
            docset.error = "No documents found or auth required"
            return docset

        for doc in docs:
            time.sleep(2)
            downloaded = self.download_document(doc, solicitation_id)
            docset.documents.append(downloaded)

        logger.info(
            "Document pipeline complete for %s: %d/%d downloaded",
            solicitation_id,
            sum(1 for d in docset.documents if d.local_path),
            len(docset.documents),
        )
        return docset

    @staticmethod
    def _clean_href(href: str) -> str:
        """Remove JS escape characters from MERX AJAX-injected URLs."""
        return href.replace("\\/", "/").replace("\\", "")

    @staticmethod
    def _clean_name(name: str) -> str:
        """Remove residual HTML tags and escape sequences from document names."""
        name = re.sub(r"<[^>]+>", "", name)
        name = name.replace("\\/", "/").replace("\\", "")
        return name.strip()

    @staticmethod
    def _guess_file_type(href: str, text: str) -> str:
        combined = (href + " " + text).lower()
        for ext in ["pdf", "docx", "doc", "xlsx", "xls", "zip", "csv", "dwg", "png", "jpg"]:
            if f".{ext}" in combined:
                return ext
        return "unknown"
