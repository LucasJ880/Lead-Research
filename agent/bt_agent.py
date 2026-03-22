#!/usr/bin/env python3
"""BidToGo Local Bids & Tenders Agent — Playwright-based document downloader.

Connects to BidToGo cloud to get high-relevance opportunities from the
Bids & Tenders source that need documents. Logs into the user's paid
bidsandtenders.ca subscription, downloads bid document ZIPs, extracts
PDFs, and uploads them to BidToGo for automatic AI deep analysis.

Usage:
    python bt_agent.py              # full run: download + upload
    python bt_agent.py --dry-run    # list pending, don't download
    python bt_agent.py --status     # check cloud connectivity only
    python bt_agent.py --headed     # run browser in visible mode

Requires .env with CLOUD_API_URL, AGENT_API_KEY, BT_EMAIL, BT_PASSWORD.
"""

from __future__ import annotations

import argparse
import os
import sys
import tempfile
import time
import zipfile
from datetime import datetime
from pathlib import Path
from typing import Optional

import requests as http_requests
from dotenv import load_dotenv

load_dotenv()

CLOUD_API_URL = os.getenv("CLOUD_API_URL", "").rstrip("/")
AGENT_API_KEY = os.getenv("AGENT_API_KEY", "")
BT_EMAIL = os.getenv("BT_EMAIL", "")
BT_PASSWORD = os.getenv("BT_PASSWORD", "")

_BT_BASE = "https://www.bidsandtenders.com"
_DOC_EXTENSIONS = {".pdf", ".docx", ".doc", ".txt", ".xlsx", ".xls", ".csv"}
_MAX_FILE_SIZE = 25 * 1024 * 1024  # 25 MB


def log(msg: str, *a: object) -> None:
    ts = datetime.now().strftime("%H:%M:%S")
    print(f"[{ts}] {msg % a}" if a else f"[{ts}] {msg}", flush=True)


# ─── Cloud API Client ──────────────────────────────────────


class CloudClient:
    def __init__(self) -> None:
        self._base = CLOUD_API_URL
        self._h = {"X-Agent-Key": AGENT_API_KEY}

    def _url(self, path: str) -> str:
        return f"{self._base}{path}"

    def check_health(self) -> bool:
        try:
            r = http_requests.get(self._url("/api/health"), timeout=10)
            data = r.json()
            log("Cloud health: %s", data.get("status", "unknown"))
            return r.ok
        except Exception as exc:
            log("Cloud health check failed: %s", exc)
            return False

    def get_pending_documents(self) -> list[dict]:
        try:
            r = http_requests.get(
                self._url("/api/agent/pending-documents"),
                headers=self._h,
                params={"source_name": "Bids and Tenders", "min_score": 80, "limit": 20},
                timeout=15,
            )
            r.raise_for_status()
            items = r.json()
            log("Pending documents: %d opportunities need document download", len(items))
            return items
        except Exception as exc:
            log("Failed to get pending documents: %s", exc)
            return []

    def upload_documents(self, opportunity_id: str, file_paths: list[Path]) -> dict | None:
        try:
            files = []
            for fp in file_paths:
                files.append(("files", (fp.name, open(fp, "rb"), "application/octet-stream")))

            r = http_requests.post(
                self._url("/api/agent/upload-documents"),
                headers={"X-Agent-Key": AGENT_API_KEY},
                data={"opportunity_id": opportunity_id, "trigger_analysis": "true"},
                files=files,
                timeout=120,
            )

            for _, (_, fobj, _) in files:
                fobj.close()

            r.raise_for_status()
            result = r.json()
            log("Upload result: %s", result)
            return result
        except Exception as exc:
            log("Upload failed for %s: %s", opportunity_id, exc)
            return None


# ─── Browser Automation ─────────────────────────────────────


class BTBrowser:
    def __init__(self, headed: bool = False) -> None:
        self._headed = headed
        self._browser = None
        self._context = None
        self._page = None

    def start(self) -> bool:
        try:
            from playwright.sync_api import sync_playwright
            self._pw = sync_playwright().start()
            self._browser = self._pw.chromium.launch(headless=not self._headed)
            self._context = self._browser.new_context(
                user_agent=(
                    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/120.0.0.0 Safari/537.36"
                ),
                accept_downloads=True,
            )
            self._page = self._context.new_page()
            log("Browser started (headed=%s)", self._headed)
            return True
        except Exception as exc:
            log("Browser start failed: %s", exc)
            return False

    def stop(self) -> None:
        try:
            if self._browser:
                self._browser.close()
            if hasattr(self, "_pw") and self._pw:
                self._pw.stop()
        except Exception:
            pass

    _logged_in_hosts: set = set()

    def login_for_url(self, view_url: str) -> bool:
        """Login on the specific organization subdomain.

        B&T uses per-org subdomains with login at:
        /Module/Tenders/en/Login/Index/{org-uuid}
        We discover the login URL by visiting the tenders index page.
        """
        if not BT_EMAIL or not BT_PASSWORD:
            log("BT_EMAIL or BT_PASSWORD not set!")
            return False

        from urllib.parse import urlparse
        parsed = urlparse(view_url)
        host = parsed.hostname or ""

        if host in self._logged_in_hosts:
            return True

        base = f"{parsed.scheme}://{host}"
        page = self._page

        try:
            log("Discovering login page on %s ...", host)
            page.goto(f"{base}/Module/Tenders/", wait_until="networkidle", timeout=30000)
            time.sleep(2)

            login_link = page.query_selector('a[href*="/Login/Index/"]')
            if not login_link:
                log("No login link found on %s — trying direct access", host)
                self._logged_in_hosts.add(host)
                return True

            login_href = login_link.get_attribute("href") or ""
            if login_href.startswith("/"):
                login_href = f"{base}{login_href}"

            log("Login URL: %s", login_href)
            page.goto(login_href, wait_until="networkidle", timeout=30000)
            time.sleep(2)

            email_field = (
                page.query_selector('#Username') or
                page.query_selector('input[name="Username"]') or
                page.query_selector('input[type="email"]') or
                page.query_selector('input[name="email"]')
            )
            pwd_field = (
                page.query_selector('#Password') or
                page.query_selector('input[name="Password"]') or
                page.query_selector('input[type="password"]')
            )

            if not email_field or not pwd_field:
                log("Login form fields not found on %s. Title: %s", host, page.title())
                return False

            email_field.fill(BT_EMAIL)
            pwd_field.fill(BT_PASSWORD)
            time.sleep(0.5)

            submit = (
                page.query_selector('input[type="submit"]') or
                page.query_selector('button[type="submit"]') or
                page.query_selector('.btn-primary') or
                page.query_selector('#loginBtn')
            )
            if submit:
                submit.click()
            else:
                pwd_field.press("Enter")

            page.wait_for_load_state("networkidle", timeout=20000)
            time.sleep(3)

            if "/Login/" in page.url:
                content = page.content().lower()
                if "invalid" in content or "error" in content or "incorrect" in content:
                    log("Login failed on %s — invalid credentials", host)
                    return False

            self._logged_in_hosts.add(host)
            log("Login successful on %s. URL: %s", host, page.url)
            return True

        except Exception as exc:
            log("Login error on %s: %s", host, exc)
            return False

    def download_bid_documents(self, view_url: str, download_dir: Path) -> Path | None:
        """Navigate to a bid detail page and download bid documents ZIP."""
        page = self._page
        try:
            log("Navigating to: %s", view_url)
            page.goto(view_url, wait_until="networkidle", timeout=30000)
            time.sleep(3)

            download_btn = (
                page.query_selector('a:has-text("Download Bid Documents")') or
                page.query_selector('a:has-text("Download")') or
                page.query_selector('input[value*="Download"]') or
                page.query_selector('button:has-text("Download")')
            )

            if not download_btn:
                log("No download button found on %s", view_url)
                log("Page title: %s", page.title())
                return None

            with page.expect_download(timeout=60000) as download_info:
                download_btn.click()

            download = download_info.value
            dest = download_dir / download.suggested_filename
            download.save_as(str(dest))
            log("Downloaded: %s (%d bytes)", dest.name, dest.stat().st_size)
            return dest

        except Exception as exc:
            log("Download failed for %s: %s", view_url, exc)
            return None


# ─── ZIP Processing ─────────────────────────────────────────


def extract_documents_from_zip(zip_path: Path, extract_dir: Path) -> list[Path]:
    """Extract supported document files from a ZIP (including nested ZIPs)."""
    found: list[Path] = []

    if not zipfile.is_zipfile(zip_path):
        if zip_path.suffix.lower() in _DOC_EXTENSIONS and zip_path.stat().st_size <= _MAX_FILE_SIZE:
            found.append(zip_path)
        return found

    try:
        with zipfile.ZipFile(zip_path, "r") as zf:
            zf.extractall(extract_dir)
    except Exception as exc:
        log("ZIP extraction failed: %s", exc)
        return found

    for path in extract_dir.rglob("*"):
        if not path.is_file():
            continue
        if path.name.startswith(".") or path.name.startswith("__"):
            continue
        if path.suffix.lower() in _DOC_EXTENSIONS and path.stat().st_size <= _MAX_FILE_SIZE:
            found.append(path)

    log("Extracted %d documents from %s", len(found), zip_path.name)
    return found


# ─── Main Flow ──────────────────────────────────────────────


def run(dry_run: bool = False, headed: bool = False) -> None:
    cloud = CloudClient()

    if not cloud.check_health():
        log("Cloud API not reachable — aborting")
        return

    pending = cloud.get_pending_documents()
    if not pending:
        log("No opportunities need document download. Done.")
        return

    log("Found %d opportunities needing documents:", len(pending))
    for item in pending:
        log("  [%d] %s — %s", item["relevance_score"], item["title"][:60], item["source_url"][:80])

    if dry_run:
        log("Dry run — not downloading")
        return

    browser = BTBrowser(headed=headed)
    if not browser.start():
        return

    success_count = 0
    fail_count = 0

    try:
        for item in pending:
            view_url = item.get("source_url", "")
            opp_id = item["opportunity_id"]
            title = item["title"][:60]

            if not view_url or "bidsandtenders" not in view_url:
                log("Skipping %s — not a bidsandtenders URL: %s", title, view_url)
                fail_count += 1
                continue

            if not browser.login_for_url(view_url):
                log("Login failed for %s — skipping", title)
                fail_count += 1
                continue

            with tempfile.TemporaryDirectory() as tmpdir:
                download_dir = Path(tmpdir)
                zip_path = browser.download_bid_documents(view_url, download_dir)

                if not zip_path:
                    log("No file downloaded for: %s", title)
                    fail_count += 1
                    continue

                extract_dir = download_dir / "extracted"
                extract_dir.mkdir()
                doc_files = extract_documents_from_zip(zip_path, extract_dir)

                if not doc_files:
                    log("No supported documents found in ZIP for: %s", title)
                    fail_count += 1
                    continue

                log("Uploading %d documents for: %s", len(doc_files), title)
                result = cloud.upload_documents(opp_id, doc_files)
                if result and result.get("documents_stored", 0) > 0:
                    success_count += 1
                    log("Upload successful for: %s — AI analysis triggered", title)
                else:
                    fail_count += 1

            time.sleep(3)

    finally:
        browser.stop()

    log("Done. Success: %d, Failed: %d", success_count, fail_count)


def main() -> None:
    parser = argparse.ArgumentParser(description="BidToGo Bids & Tenders Document Agent")
    parser.add_argument("--dry-run", action="store_true", help="List pending, don't download")
    parser.add_argument("--status", action="store_true", help="Check cloud connectivity only")
    parser.add_argument("--headed", action="store_true", help="Run browser in visible mode")
    args = parser.parse_args()

    if not CLOUD_API_URL or not AGENT_API_KEY:
        log("CLOUD_API_URL and AGENT_API_KEY must be set in .env")
        sys.exit(1)

    if args.status:
        cloud = CloudClient()
        ok = cloud.check_health()
        sys.exit(0 if ok else 1)

    run(dry_run=args.dry_run, headed=args.headed)


if __name__ == "__main__":
    main()
