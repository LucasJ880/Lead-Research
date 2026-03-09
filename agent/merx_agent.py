#!/usr/bin/env python3
"""BidToGo Local MERX Agent — crawls MERX from a trusted local machine
and syncs results to the cloud BidToGo instance.

Usage:
    python merx_agent.py              # one-shot: request job, crawl, upload
    python merx_agent.py --dry-run    # crawl but don't upload
    python merx_agent.py --status     # check cloud connectivity

Requires .env with CLOUD_API_URL, AGENT_API_KEY, MERX_EMAIL, MERX_PASSWORD.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urljoin, quote_plus

import requests
from bs4 import BeautifulSoup, Tag
from dotenv import load_dotenv

load_dotenv()

# ─── Configuration ──────────────────────────────────────────

CLOUD_API_URL = os.getenv("CLOUD_API_URL", "").rstrip("/")
AGENT_API_KEY = os.getenv("AGENT_API_KEY", "")
MERX_EMAIL = os.getenv("MERX_EMAIL", "")
MERX_PASSWORD = os.getenv("MERX_PASSWORD", "")

_MERX_BASE = "https://www.merx.com"
_LISTING_URL = f"{_MERX_BASE}/public/solicitations/open"
_LOGIN_URL = f"{_MERX_BASE}/public/authentication/login"
_DATE_RE = re.compile(r"(\d{4}/\d{2}/\d{2})")

_SEARCH_KEYWORDS = [
    "blinds", "curtains", "shades", "drapery", "window covering",
    "window treatment", "furniture", "furnishing", "textile", "linen",
    "bedding", "renovation interior", "hospital curtain", "privacy curtain",
    "cubicle curtain", "FF&E", "roller shade", "motorized shade",
    "fabric", "upholstery", "carpet", "interior fit-out",
]

_CATEGORY_SEARCHES = [
    ("10013", "Furniture"),
    ("10028", "Textiles and Apparel"),
    ("10004", "Construction Services"),
    ("10054", "Maint, Repair, Modification"),
]

_PROVINCE_MAP = {
    "ONTARIO": "ON", "BRITISH COLUMBIA": "BC", "ALBERTA": "AB",
    "QUEBEC": "QC", "MANITOBA": "MB", "SASKATCHEWAN": "SK",
    "NOVA SCOTIA": "NS", "NEW BRUNSWICK": "NB",
    "NEWFOUNDLAND": "NL", "PRINCE EDWARD": "PE",
    ", ON,": "ON", ", BC,": "BC", ", AB,": "AB", ", QC,": "QC",
    ", MB,": "MB", ", SK,": "SK", ", NS,": "NS", ", NB,": "NB",
}


def log(msg: str, *args: object) -> None:
    ts = datetime.now().strftime("%H:%M:%S")
    print(f"[{ts}] {msg % args}" if args else f"[{ts}] {msg}")


# ─── Cloud API Client ──────────────────────────────────────


class CloudClient:
    """Communicates with the BidToGo cloud sync API."""

    def __init__(self) -> None:
        self._base = CLOUD_API_URL
        self._headers = {"X-Agent-Key": AGENT_API_KEY, "Content-Type": "application/json"}
        # The scraper API runs on port 8001 inside Docker
        self._scraper_base = self._base.replace(":3000", ":8001")
        if "://" in self._base and ":8001" not in self._scraper_base:
            # For production behind Caddy, use the scraper-api container directly
            self._scraper_base = CLOUD_API_URL

    def _url(self, path: str) -> str:
        return f"{self._scraper_base}{path}"

    def check_health(self) -> bool:
        try:
            r = requests.get(self._url("/api/health"), timeout=10)
            data = r.json()
            log("Cloud health: %s", data.get("status", "unknown"))
            return r.ok
        except Exception as exc:
            log("Cloud health check failed: %s", exc)
            return False

    def create_job(self) -> dict | None:
        try:
            r = requests.post(self._url("/api/agent/jobs/create"), headers=self._headers, json={}, timeout=15)
            r.raise_for_status()
            jobs = r.json()
            if not jobs:
                log("No jobs available")
                return None
            return jobs[0] if isinstance(jobs, list) else jobs
        except Exception as exc:
            log("Failed to create job: %s", exc)
            return None

    def update_status(self, run_id: str, status: str, **kwargs: object) -> None:
        payload = {"run_id": run_id, "status": status, **kwargs}
        try:
            r = requests.post(
                self._url(f"/api/agent/jobs/{run_id}/status"),
                headers=self._headers, json=payload, timeout=15,
            )
            r.raise_for_status()
        except Exception as exc:
            log("Status update failed: %s", exc)

    def upload_opportunities(self, run_id: str, source_id: str, opps: list[dict]) -> dict:
        payload = {"run_id": run_id, "source_id": source_id, "opportunities": opps}
        try:
            r = requests.post(
                self._url("/api/agent/opportunities"),
                headers=self._headers, json=payload, timeout=60,
            )
            r.raise_for_status()
            return r.json()
        except Exception as exc:
            log("Upload failed: %s", exc)
            return {"status": "error", "error": str(exc)}

    def upload_documents(self, source_id: str, external_id: str, docs: list[dict]) -> dict:
        payload = {"source_id": source_id, "opportunity_external_id": external_id, "documents": docs}
        try:
            r = requests.post(
                self._url("/api/agent/documents"),
                headers=self._headers, json=payload, timeout=30,
            )
            r.raise_for_status()
            return r.json()
        except Exception as exc:
            log("Document upload failed: %s", exc)
            return {"status": "error"}


# ─── MERX Session ───────────────────────────────────────────


class MerxSession:
    """Authenticated MERX session running from local machine."""

    def __init__(self) -> None:
        self._http = requests.Session()
        self._http.headers.update({
            "User-Agent": (
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/120.0.0.0 Safari/537.36"
            ),
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-CA,en-US;q=0.9,en;q=0.8",
        })
        self.authenticated = False

    def login(self) -> bool:
        if not MERX_EMAIL or not MERX_PASSWORD:
            log("MERX credentials not set")
            return False

        log("Visiting MERX homepage...")
        try:
            r = self._http.get(_MERX_BASE, timeout=15)
            r.raise_for_status()
        except Exception as exc:
            log("Homepage failed: %s", exc)
            return False

        soup = BeautifulSoup(r.text, "lxml")
        csrf = soup.find("input", {"name": "_csrf"})
        token = csrf.get("value", "") if csrf else ""

        time.sleep(1)
        log("Logging in (email: %s...)", MERX_EMAIL[:3] + "***")
        try:
            r = self._http.post(
                _LOGIN_URL,
                data={"j_username": MERX_EMAIL, "j_password": MERX_PASSWORD, "_csrf": token},
                headers={"Content-Type": "application/x-www-form-urlencoded", "Referer": _MERX_BASE},
                timeout=20, allow_redirects=True,
            )
        except Exception as exc:
            log("Login request failed: %s", exc)
            return False

        body = r.text.lower()
        if "invalid" in body and "password" in body:
            log("Login rejected — invalid credentials")
            return False

        if "logout" in body or "my account" in body or "sign out" in body:
            self.authenticated = True
            log("Login successful")
            return True

        cookies = [c.name for c in self._http.cookies]
        if "JSESSIONID" in cookies:
            self.authenticated = True
            log("Login completed (session cookies present)")
            return True

        log("Login status uncertain — proceeding")
        self.authenticated = True
        return True

    def fetch(self, url: str, retries: int = 3) -> str | None:
        for attempt in range(1, retries + 1):
            try:
                r = self._http.get(url, timeout=20)
                r.raise_for_status()
                return r.text
            except Exception as exc:
                log("Fetch %s attempt %d/%d: %s", url[:80], attempt, retries, exc)
                time.sleep(2 * attempt)
        return None

    def fetch_document_list(self, internal_id: str) -> list[dict]:
        ajax_url = f"{_MERX_BASE}/public/solicitations/{internal_id}/abstract/docs-items"
        try:
            r = self._http.get(
                ajax_url,
                headers={"X-Requested-With": "XMLHttpRequest"},
                timeout=20,
            )
            r.raise_for_status()
        except Exception as exc:
            log("Document fetch failed for %s: %s", internal_id, exc)
            return []

        raw = r.text
        html_match = re.search(r'\.html\([\'"](.+?)[\'"]\);?\s*$', raw, re.DOTALL)
        html_content = html_match.group(1) if html_match else raw
        try:
            html_content = html_content.encode("utf-8").decode("unicode_escape")
        except (UnicodeDecodeError, UnicodeEncodeError):
            html_content = html_content.replace(r"\u003C", "<").replace(r"\u003E", ">")

        if "loginRegisterInterception" in html_content:
            log("Document tab shows login prompt — auth may have expired")
            return []

        soup = BeautifulSoup(html_content, "lxml")
        documents: list[dict] = []

        for link in soup.find_all("a", href=True):
            href = link.get("href", "").replace("\\/", "/").replace("\\", "")
            text = re.sub(r"<[^>]+>", "", link.get_text(strip=True))
            if any(kw in href.lower() for kw in ["download", "document", ".pdf", ".doc", "attachment"]):
                url = urljoin(_MERX_BASE, href)
                ft = "pdf" if ".pdf" in href.lower() else "unknown"
                documents.append({"name": text or "Document", "url": url, "file_type": ft})

        return documents


# ─── MERX Crawler ───────────────────────────────────────────


def _parse_date(raw: str) -> str | None:
    m = _DATE_RE.search(raw.strip())
    if not m:
        return None
    try:
        dt = datetime.strptime(m.group(1), "%Y/%m/%d")
        return dt.replace(tzinfo=timezone.utc).isoformat()
    except ValueError:
        return None


def _clean(text: str) -> str:
    return " ".join(text.split()).strip()


def _extract_region(location_raw: str) -> str | None:
    loc = location_raw.upper()
    for pattern, code in _PROVINCE_MAP.items():
        if pattern in loc:
            return code
    return None


@dataclass
class CrawlStats:
    listing_pages: int = 0
    detail_pages: int = 0
    rows_parsed: int = 0
    errors: int = 0


def crawl_merx(session: MerxSession, config: dict) -> tuple[list[dict], CrawlStats]:
    """Run the full MERX crawl and return normalized opportunity dicts."""
    max_pages = config.get("max_pages_per_search", 5)
    fetch_detail = config.get("fetch_detail", True)
    stats = CrawlStats()
    seen_urls: set[str] = set()
    all_opps: list[dict] = []

    for kw in _SEARCH_KEYWORDS:
        opps = _search(session, f"keywords={quote_plus(kw)}", max_pages, fetch_detail, seen_urls, stats)
        all_opps.extend(opps)
        log("  kw %-30s → %d opps", kw, len(opps))

    for cat_code, cat_name in _CATEGORY_SEARCHES:
        opps = _search(session, f"category={cat_code}", max_pages, fetch_detail, seen_urls, stats)
        all_opps.extend(opps)
        log("  cat %-28s → %d opps", cat_name, len(opps))

    log("Crawl complete: %d unique opps | %d listing pages | %d detail pages | %d errors",
        len(all_opps), stats.listing_pages, stats.detail_pages, stats.errors)
    return all_opps, stats


def _search(
    session: MerxSession, query_param: str, max_pages: int,
    fetch_detail: bool, seen: set[str], stats: CrawlStats,
) -> list[dict]:
    results: list[dict] = []
    for page in range(1, max_pages + 1):
        url = f"{_LISTING_URL}?{query_param}&pageNumber={page}"
        html = session.fetch(url)
        if not html:
            stats.errors += 1
            break
        stats.listing_pages += 1
        soup = BeautifulSoup(html, "lxml")
        rows = soup.find_all("tr", class_="mets-table-row")
        if not rows:
            break

        page_opps: list[dict] = []
        for row in rows:
            try:
                opp = _parse_row(session, row, fetch_detail, stats)
                if opp and opp["source_url"] not in seen:
                    seen.add(opp["source_url"])
                    stats.rows_parsed += 1
                    page_opps.append(opp)
            except Exception:
                stats.errors += 1
        results.extend(page_opps)
        if len(rows) < 5:
            break
        time.sleep(2)
    return results


def _parse_row(session: MerxSession, row: Tag, fetch_detail: bool, stats: CrawlStats) -> dict | None:
    link = row.find("a", href=lambda h: h and "open-bids" in str(h))
    if not link:
        return None

    href = link.get("href", "")
    detail_url = urljoin(_MERX_BASE, href.split("?")[0])

    title_el = row.find("span", class_="rowTitle")
    title = _clean(title_el.get_text()) if title_el else ""
    if not title:
        return None

    org_el = row.find("span", class_="buyer-name")
    org_name = _clean(org_el.get_text()) if org_el else None

    loc_el = row.find("span", class_="location")
    location_raw = _clean(loc_el.get_text()) if loc_el else ""
    region = _extract_region(location_raw)

    pub_date_el = row.find("span", class_="publicationDate")
    posted_date = None
    if pub_date_el:
        date_val = pub_date_el.find("span", class_="dateValue")
        if date_val:
            pd = _parse_date(date_val.get_text())
            posted_date = pd[:10] if pd else None

    close_el = row.find("span", class_="closingDate")
    closing_date = None
    if close_el:
        closing_date = _parse_date(close_el.get_text())

    description = None
    category = None
    contact_name = None
    contact_email = None
    solicitation_num = None

    if fetch_detail and detail_url:
        detail = _fetch_detail(session, detail_url, stats)
        if detail:
            description = detail.get("description")
            category = detail.get("category") or detail.get("solicitation_type")
            contact_name = detail.get("contact_name")
            contact_email = detail.get("contact_email")
            solicitation_num = detail.get("solicitation_number")
            full_title = detail.get("full_title")
            if full_title and len(full_title) > len(title):
                title = full_title
            if detail.get("owner_organization") and not org_name:
                org_name = detail["owner_organization"]

    return {
        "source_id": "",  # filled by cloud
        "external_id": solicitation_num,
        "title": title,
        "description_summary": description[:500] if description else None,
        "description_full": description,
        "status": "open",
        "country": "CA",
        "region": region,
        "location_raw": location_raw or "Canada",
        "posted_date": posted_date,
        "closing_date": closing_date,
        "category": category or "Procurement",
        "solicitation_number": solicitation_num,
        "currency": "CAD",
        "contact_name": contact_name,
        "contact_email": contact_email,
        "source_url": detail_url,
        "has_documents": True,
        "organization_name": org_name,
        "fingerprint": "",
        "raw_data": {
            "parser_version": "merx_agent_v1",
            "solicitation_number": solicitation_num,
            "fetch_timestamp": datetime.now(timezone.utc).isoformat(),
        },
    }


def _fetch_detail(session: MerxSession, url: str, stats: CrawlStats) -> dict | None:
    html = session.fetch(url)
    if not html:
        return None
    stats.detail_pages += 1

    soup = BeautifulSoup(html, "lxml")
    fields: dict[str, str] = {}
    for fd in soup.find_all("div", class_="mets-field"):
        lbl = fd.find("span", class_="mets-field-label")
        body = fd.find("div", class_="mets-field-body")
        if lbl and body:
            key = _clean(lbl.get_text()).lower()
            key = re.sub(r"[A-Z]\s*-\s*(Latest|Previous)\s+Amendment\s*", "", key).strip()
            val = _clean(body.get_text())
            if key and val:
                fields[key] = val

    result: dict = {}
    result["full_title"] = fields.get("title", "")
    h1 = soup.find("h1", class_="solicitationName")
    if h1:
        h1_text = _clean(h1.get_text())
        if h1_text and len(h1_text) > len(result.get("full_title", "")):
            result["full_title"] = h1_text

    result["description"] = fields.get("description", "")
    result["solicitation_number"] = fields.get("solicitation number", "")
    result["solicitation_type"] = fields.get("solicitation type", "")
    result["owner_organization"] = fields.get("owner organization", "")
    result["location"] = fields.get("location", "")

    for key in ["commodity", "category", "gsin", "unspsc"]:
        if key in fields:
            result["category"] = fields[key]
            break

    contact_section = soup.find("h3", string=re.compile(r"Contact\s+Information", re.I))
    if contact_section:
        container = contact_section.find_parent("div", class_="content-block")
        if container:
            for fd in container.find_all("div", class_="mets-field"):
                lbl = fd.find("span", class_="mets-field-label")
                body = fd.find("div", class_="mets-field-body")
                if lbl and body:
                    k = _clean(lbl.get_text()).lower()
                    v = _clean(body.get_text())
                    if k == "name":
                        result["contact_name"] = v
                    elif k == "email":
                        result["contact_email"] = v

    if not result.get("contact_email"):
        email_link = soup.find("a", href=re.compile(r"^mailto:"))
        if email_link:
            result["contact_email"] = email_link.get_text(strip=True)

    return {k: v for k, v in result.items() if v}


# ─── Main ───────────────────────────────────────────────────


def check_config() -> bool:
    ok = True
    if not CLOUD_API_URL:
        log("ERROR: CLOUD_API_URL not set")
        ok = False
    if not AGENT_API_KEY:
        log("ERROR: AGENT_API_KEY not set")
        ok = False
    if not MERX_EMAIL or not MERX_PASSWORD:
        log("ERROR: MERX_EMAIL / MERX_PASSWORD not set")
        ok = False
    return ok


def main() -> None:
    parser = argparse.ArgumentParser(description="BidToGo Local MERX Agent")
    parser.add_argument("--dry-run", action="store_true", help="Crawl but don't upload")
    parser.add_argument("--status", action="store_true", help="Check cloud connectivity")
    args = parser.parse_args()

    log("BidToGo MERX Agent starting")

    if not check_config():
        sys.exit(1)

    cloud = CloudClient()

    if args.status:
        cloud.check_health()
        sys.exit(0)

    # 1. Request a job from the cloud
    log("Requesting job from cloud...")
    job = cloud.create_job()
    if not job:
        log("No jobs available — exiting")
        sys.exit(0)

    run_id = job["run_id"]
    source_id = job["source_id"]
    config = job.get("crawl_config", {})
    log("Job received: run=%s source=%s (%s)", run_id, source_id, job["source_name"])

    # 2. Report running
    cloud.update_status(run_id, "running")

    # 3. Authenticate to MERX
    merx = MerxSession()
    if not merx.login():
        cloud.update_status(run_id, "failed", error_message="MERX login failed")
        log("MERX login failed — aborting")
        sys.exit(1)

    # 4. Crawl
    log("Starting MERX crawl...")
    opps, stats = crawl_merx(merx, config)

    if args.dry_run:
        log("Dry run — %d opportunities found, not uploading", len(opps))
        for opp in opps[:5]:
            log("  %s — %s", opp["title"][:60], opp.get("closing_date", "no date"))
        sys.exit(0)

    # 5. Upload opportunities in batches
    BATCH_SIZE = 50
    total_created = 0
    total_updated = 0
    total_skipped = 0
    upload_errors = 0

    for i in range(0, len(opps), BATCH_SIZE):
        batch = opps[i:i + BATCH_SIZE]
        log("Uploading batch %d-%d of %d...", i + 1, min(i + BATCH_SIZE, len(opps)), len(opps))
        result = cloud.upload_opportunities(run_id, source_id, batch)
        total_created += result.get("created", 0)
        total_updated += result.get("updated", 0)
        total_skipped += result.get("skipped", 0)
        upload_errors += result.get("errors", 0)

    # 6. Report final status
    final_status = "completed" if upload_errors == 0 else "completed"
    cloud.update_status(
        run_id, final_status,
        pages_crawled=stats.listing_pages,
        opportunities_found=len(opps),
        opportunities_created=total_created,
        opportunities_updated=total_updated,
        opportunities_skipped=total_skipped,
        metadata={
            "agent": "merx_agent_v1",
            "detail_pages": stats.detail_pages,
            "crawl_errors": stats.errors,
            "upload_errors": upload_errors,
        },
    )

    log("Done! created=%d updated=%d skipped=%d errors=%d",
        total_created, total_updated, total_skipped, upload_errors)


if __name__ == "__main__":
    main()
