#!/usr/bin/env python3
"""BidToGo Local MERX Agent — Playwright-based authenticated browser crawl.

Runs from a trusted local machine where MERX is accessible.
Logs in via a real browser, navigates listing/detail/documents pages
in the same authenticated context, and syncs results to the cloud.

Usage:
    python merx_agent.py              # full crawl + upload
    python merx_agent.py --dry-run    # crawl, print results, don't upload
    python merx_agent.py --status     # check cloud connectivity only
    python merx_agent.py --verify     # login + verify private page access

Requires .env with CLOUD_API_URL, AGENT_API_KEY, MERX_EMAIL, MERX_PASSWORD.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Optional
from urllib.parse import quote_plus, urljoin

import requests as http_requests
from dotenv import load_dotenv

load_dotenv()

CLOUD_API_URL = os.getenv("CLOUD_API_URL", "").rstrip("/")
AGENT_API_KEY = os.getenv("AGENT_API_KEY", "")
MERX_EMAIL = os.getenv("MERX_EMAIL", "")
MERX_PASSWORD = os.getenv("MERX_PASSWORD", "")

_MERX_BASE = "https://www.merx.com"
_LOGIN_URL = f"{_MERX_BASE}/public/authentication/login"
_LOGOUT_URL = f"{_MERX_BASE}/public/authentication/logout"
_IDP_LOGOUT_URL = "https://idp.merx.com/profile/Logout"
_LISTING_URL = f"{_MERX_BASE}/public/solicitations/open"
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


def log(msg: str, *a: object) -> None:
    ts = datetime.now().strftime("%H:%M:%S")
    print(f"[{ts}] {msg % a}" if a else f"[{ts}] {msg}", flush=True)


# ─── Cloud API Client ──────────────────────────────────────


class CloudClient:
    """Cloud sync — plain HTTP is fine here (talking to our own API)."""

    def __init__(self) -> None:
        self._base = CLOUD_API_URL
        self._h = {"X-Agent-Key": AGENT_API_KEY, "Content-Type": "application/json"}

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

    def create_job(self) -> Optional[dict]:
        try:
            r = http_requests.post(self._url("/api/agent/jobs/create"), headers=self._h, json={}, timeout=15)
            r.raise_for_status()
            jobs = r.json()
            if not jobs:
                return None
            return jobs[0] if isinstance(jobs, list) else jobs
        except Exception as exc:
            log("Failed to create job: %s", exc)
            return None

    def update_status(self, run_id: str, status: str, **kw: object) -> None:
        try:
            http_requests.post(
                self._url(f"/api/agent/jobs/{run_id}/status"),
                headers=self._h, json={"run_id": run_id, "status": status, **kw}, timeout=15,
            ).raise_for_status()
        except Exception as exc:
            log("Status update failed: %s", exc)

    def upload_opportunities(self, run_id: str, source_id: str, opps: list) -> dict:
        try:
            r = http_requests.post(
                self._url("/api/agent/opportunities"),
                headers=self._h, json={"run_id": run_id, "source_id": source_id, "opportunities": opps}, timeout=60,
            )
            r.raise_for_status()
            return r.json()
        except Exception as exc:
            log("Upload failed: %s", exc)
            return {"status": "error", "error": str(exc)}


# ─── Playwright MERX Browser ──────────────────────────────


@dataclass
class CrawlStats:
    listing_pages: int = 0
    detail_pages: int = 0
    rows_parsed: int = 0
    errors: int = 0


class MerxBrowser:
    """Single Playwright browser context for all MERX operations."""

    def __init__(self, headless: bool = True) -> None:
        from playwright.sync_api import sync_playwright
        self._pw = sync_playwright().start()
        self._browser = self._pw.chromium.launch(headless=headless)
        self._ctx = self._browser.new_context(
            user_agent=(
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/120.0.0.0 Safari/537.36"
            ),
            viewport={"width": 1280, "height": 900},
            locale="en-CA",
        )
        self._page = self._ctx.new_page()
        self.authenticated = False

    def close(self) -> None:
        try:
            self._ctx.close()
            self._browser.close()
            self._pw.stop()
        except Exception:
            pass

    # ── Login ──

    def force_logout(self) -> None:
        """Attempt to clear any existing MERX sessions before login."""
        page = self._page
        log("Attempting to clear existing MERX sessions...")
        try:
            page.goto(_LOGOUT_URL, wait_until="domcontentloaded", timeout=15000)
            time.sleep(1)
        except Exception:
            pass
        try:
            page.goto(f"{_MERX_BASE}/saml/logout", wait_until="domcontentloaded", timeout=10000)
            time.sleep(1)
        except Exception:
            pass
        self._ctx.clear_cookies()
        log("Cleared cookies and hit logout endpoints")

    def login(self, max_retries: int = 3, retry_delay: int = 30) -> bool:
        if not MERX_EMAIL or not MERX_PASSWORD:
            log("MERX credentials not set")
            return False

        page = self._page

        # MERX uses SAML SSO — navigating to /public/authentication/login
        # redirects to /saml/login with a standard form (#loginForm)
        log("Navigating to MERX SAML login page...")
        try:
            page.goto(_LOGIN_URL, wait_until="domcontentloaded", timeout=30000)
            time.sleep(2)
        except Exception as exc:
            log("Login page navigation failed: %s", exc)
            return False

        log("Current URL: %s", page.url)

        log("Filling SAML login form (email: %s...)", MERX_EMAIL[:3] + "***")
        try:
            # SAML login page has #j_username, #j_password, and a submit button
            email_field = page.locator('#j_username, input[name="j_username"]').first
            pass_field = page.locator('#j_password, input[name="j_password"]').first

            email_field.wait_for(state="visible", timeout=10000)
            email_field.fill(MERX_EMAIL)
            pass_field.fill(MERX_PASSWORD)
            time.sleep(0.5)

            submit = page.locator('#loginForm button[type="submit"], #loginForm input[type="submit"], .login-button, button.submit')
            if submit.count() > 0:
                submit.first.click()
            else:
                pass_field.press("Enter")

            # SAML SSO may trigger multiple redirects; wait for it to settle
            try:
                page.wait_for_load_state("networkidle", timeout=25000)
            except Exception:
                pass
            time.sleep(3)

            # Final wait to let last redirect finish
            try:
                page.wait_for_load_state("domcontentloaded", timeout=10000)
            except Exception:
                pass

        except Exception as exc:
            log("Login form interaction failed: %s", exc)
            return False

        url = page.url
        try:
            body = page.content().lower()
        except Exception:
            time.sleep(3)
            body = page.content().lower()
        log("Post-login URL: %s", url)

        if "invalid" in body and ("password" in body or "credentials" in body):
            log("login_failed: invalid credentials")
            return False

        if "currently in use" in body:
            log("login_blocked: concurrent session — MERX allows one session per account")
            for attempt in range(1, max_retries + 1):
                log("Retry %d/%d: clearing cookies, waiting %ds...", attempt, max_retries, retry_delay)
                self._ctx.clear_cookies()
                time.sleep(retry_delay)
                try:
                    page.goto(_LOGIN_URL, wait_until="domcontentloaded", timeout=30000)
                    time.sleep(2)
                    ef = page.locator('#j_username, input[name="j_username"]').first
                    pf = page.locator('#j_password, input[name="j_password"]').first
                    ef.wait_for(state="visible", timeout=10000)
                    ef.fill(MERX_EMAIL)
                    pf.fill(MERX_PASSWORD)
                    page.locator('#loginButton, button[type="submit"]').first.click()
                    try:
                        page.wait_for_load_state("networkidle", timeout=25000)
                    except Exception:
                        pass
                    time.sleep(3)
                    try:
                        page.wait_for_load_state("domcontentloaded", timeout=10000)
                    except Exception:
                        pass
                    url = page.url
                    body = page.content().lower()
                    if "currently in use" not in body:
                        break
                except Exception as exc2:
                    log("login_retry_%d_failed: %s", attempt, exc2)
            else:
                log("login_failed: session still in use after %d retries", max_retries)
                log("Please close any open MERX browser tabs and wait a few minutes before retrying.")
                return False

        if any(kw in body for kw in ["logout", "my account", "sign out", "my solicitations", "welcome"]):
            self.authenticated = True
            log("login_succeeded (confirmed via page content)")
            return True

        cookies = self._ctx.cookies()
        cookie_names = [c["name"] for c in cookies]
        log("Post-login cookies: %s", cookie_names)
        if "JSESSIONID" in cookie_names:
            self.authenticated = True
            log("login_succeeded (JSESSIONID present)")
            return True

        log("login_uncertain — proceeding cautiously")
        self.authenticated = True
        return True

    # ── Page access ──

    def navigate(self, url: str, label: str = "page", timeout: int = 25000) -> Optional[str]:
        """Navigate within the authenticated context. Returns page HTML or None."""
        try:
            resp = self._page.goto(url, wait_until="domcontentloaded", timeout=timeout)
            time.sleep(1)
            final_url = self._page.url
            status = resp.status if resp else 0
            content = self._page.content()

            if status == 403 or "access denied" in content.lower():
                log("%s_access_denied: %s → HTTP %d (final: %s)", label, url[:80], status, final_url[:80])
                return None
            if "/authentication/login" in final_url.lower():
                log("%s_redirected_to_login: %s → %s", label, url[:80], final_url[:80])
                return None
            if status >= 400:
                log("%s_http_error: %s → HTTP %d", label, url[:80], status)
                return None

            log("%s_ok: %s (HTTP %d, %d chars)", label, url[:70], status, len(content))
            return content

        except Exception as exc:
            log("%s_failed: %s → %s", label, url[:80], exc)
            return None

    def verify_access(self) -> dict:
        """Verify access to listing, detail, and documents pages. Returns report."""
        report = {}

        log("=== ACCESS VERIFICATION ===")

        listing_url = f"{_LISTING_URL}?keywords=furniture&pageNumber=1"
        html = self.navigate(listing_url, "listing")
        report["listing"] = html is not None

        if html:
            from bs4 import BeautifulSoup
            soup = BeautifulSoup(html, "lxml")
            rows = soup.find_all("tr", class_="mets-table-row")
            report["listing_rows"] = len(rows)
            log("Listing rows found: %d", len(rows))

            if rows:
                link = rows[0].find("a", class_="solicitationsTitleLink")
                if not link:
                    link = rows[0].find("a", href=lambda h: h and "open-solicitation" in str(h))
                if link:
                    detail_href = link.get("href", "")
                    detail_url = urljoin(_MERX_BASE, detail_href)
                    d_html = self.navigate(detail_url, "detail")
                    report["detail"] = d_html is not None
                    if d_html:
                        report["detail_length"] = len(d_html)
                else:
                    report["detail"] = False
                    log("No detail link found in first row")
        else:
            report["listing_rows"] = 0
            report["detail"] = False

        log("=== VERIFICATION RESULT: %s ===", json.dumps(report))
        return report

    # ── Extraction ──

    def search_listings(self, query_param: str, max_pages: int, stats: CrawlStats) -> list:
        """Search MERX and extract listing rows from rendered DOM."""
        from bs4 import BeautifulSoup

        all_rows_data = []
        for pg in range(1, max_pages + 1):
            url = f"{_LISTING_URL}?{query_param}&pageNumber={pg}"
            html = self.navigate(url, "listing")
            if not html:
                stats.errors += 1
                break
            stats.listing_pages += 1

            soup = BeautifulSoup(html, "lxml")
            rows = soup.find_all("tr", class_="mets-table-row")
            if not rows:
                break

            for row in rows:
                parsed = self._parse_listing_row(row)
                if parsed:
                    all_rows_data.append(parsed)

            if len(rows) < 10:
                break
            time.sleep(1.5)

        return all_rows_data

    def fetch_detail(self, detail_url: str, stats: CrawlStats) -> Optional[dict]:
        """Fetch a detail page in the browser and extract fields."""
        from bs4 import BeautifulSoup

        html = self.navigate(detail_url, "detail")
        if not html:
            return None
        stats.detail_pages += 1

        soup = BeautifulSoup(html, "lxml")
        fields = {}
        for fd in soup.find_all("div", class_="mets-field"):
            lbl_el = fd.find("span", class_="mets-field-label")
            body_el = fd.find("div", class_="mets-field-body")
            if lbl_el and body_el:
                key = _clean(lbl_el.get_text()).lower()
                key = re.sub(r"[A-Z]\s*-\s*(Latest|Previous)\s+Amendment\s*", "", key).strip()
                val = _clean(body_el.get_text())
                if key and val:
                    fields[key] = val

        result = {}
        result["full_title"] = fields.get("title", "")
        h1 = soup.find("h1", class_="solicitationName")
        if h1:
            h1t = _clean(h1.get_text())
            if h1t and len(h1t) > len(result.get("full_title", "")):
                result["full_title"] = h1t

        result["description"] = fields.get("description", "")
        result["solicitation_number"] = fields.get("solicitation number", "")
        result["solicitation_type"] = fields.get("solicitation type", "")
        result["owner_organization"] = fields.get("owner organization", "")
        result["location"] = fields.get("location", "")

        for key in ["commodity", "category", "gsin", "unspsc"]:
            if key in fields:
                result["category"] = fields[key]
                break

        contact_h3 = soup.find("h3", string=re.compile(r"Contact\s+Information", re.I))
        if contact_h3:
            container = contact_h3.find_parent("div", class_="content-block")
            if container:
                for fd in container.find_all("div", class_="mets-field"):
                    lbl_el = fd.find("span", class_="mets-field-label")
                    body_el = fd.find("div", class_="mets-field-body")
                    if lbl_el and body_el:
                        k = _clean(lbl_el.get_text()).lower()
                        v = _clean(body_el.get_text())
                        if k == "name":
                            result["contact_name"] = v
                        elif k == "email":
                            result["contact_email"] = v

        if not result.get("contact_email"):
            mailto = soup.find("a", href=re.compile(r"^mailto:"))
            if mailto:
                result["contact_email"] = mailto.get_text(strip=True)

        return {k: v for k, v in result.items() if v}

    def _parse_listing_row(self, row) -> Optional[dict]:
        link = row.find("a", class_="solicitationsTitleLink")
        if not link:
            link = row.find("a", href=lambda h: h and ("open-solicitation" in str(h) or "view-notice" in str(h)))
        if not link:
            return None

        href = link.get("href", "")
        detail_url = urljoin(_MERX_BASE, href.split("?")[0])
        title = _clean(link.get_text())
        if not title:
            return None

        org_el = row.find("span", class_="buyerIdentification")
        org_name = _clean(org_el.get_text()) if org_el else None

        location_raw = ""
        region_el = row.find("span", class_="regionValue")
        if region_el:
            location_raw = _clean(region_el.get_text())
        if not location_raw:
            script = row.find("script")
            if script:
                loc_m = re.search(r'"location"\s*:\s*"([^"]*)"', script.get_text())
                if loc_m:
                    location_raw = loc_m.group(1).replace("\\", "")
        region = _extract_region(location_raw)

        date_vals = row.find_all("span", class_="dateValue")
        closing_date = _parse_date(date_vals[0].get_text()) if date_vals else None
        posted_date = None
        if len(date_vals) > 1:
            pd = _parse_date(date_vals[1].get_text())
            posted_date = pd[:10] if pd else None

        return {
            "title": title,
            "detail_url": detail_url,
            "org_name": org_name,
            "location_raw": location_raw,
            "region": region,
            "closing_date": closing_date,
            "posted_date": posted_date,
        }


# ─── Helpers ─────────────────────────────────────────────


def _parse_date(raw: str) -> Optional[str]:
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


def _extract_region(location_raw: str) -> Optional[str]:
    loc = location_raw.upper()
    for pattern, code in _PROVINCE_MAP.items():
        if pattern in loc:
            return code
    return None


def _fingerprint(title: str, org: str, closing: str) -> str:
    raw = f"{title}|{org}|{closing}".lower()
    return hashlib.sha256(raw.encode()).hexdigest()


# ─── Orchestrator ────────────────────────────────────────


def crawl_merx(browser: MerxBrowser, config: dict) -> tuple:
    max_pages = config.get("max_pages_per_search", 5)
    fetch_detail = config.get("fetch_detail", True)
    stats = CrawlStats()
    seen_urls = set()
    all_opps = []

    for kw in _SEARCH_KEYWORDS:
        rows = browser.search_listings(f"keywords={quote_plus(kw)}", max_pages, stats)
        new_opps = _process_rows(browser, rows, fetch_detail, seen_urls, stats)
        all_opps.extend(new_opps)
        log("  kw %-30s → %d rows, %d new", kw, len(rows), len(new_opps))

    for cat_code, cat_name in _CATEGORY_SEARCHES:
        rows = browser.search_listings(f"category={cat_code}", max_pages, stats)
        new_opps = _process_rows(browser, rows, fetch_detail, seen_urls, stats)
        all_opps.extend(new_opps)
        log("  cat %-28s → %d rows, %d new", cat_name, len(rows), len(new_opps))

    log("Crawl complete: %d unique opps | %d listing pgs | %d detail pgs | %d errors",
        len(all_opps), stats.listing_pages, stats.detail_pages, stats.errors)
    return all_opps, stats


def _process_rows(
    browser: MerxBrowser, rows: list, fetch_detail: bool,
    seen: set, stats: CrawlStats,
) -> list:
    results = []
    for row in rows:
        url = row["detail_url"]
        if url in seen:
            continue
        seen.add(url)
        stats.rows_parsed += 1

        description = None
        category = None
        contact_name = None
        contact_email = None
        solicitation_num = None
        title = row["title"]
        org_name = row["org_name"]

        if fetch_detail and url:
            detail = browser.fetch_detail(url, stats)
            if detail:
                description = detail.get("description")
                category = detail.get("category") or detail.get("solicitation_type")
                contact_name = detail.get("contact_name")
                contact_email = detail.get("contact_email")
                solicitation_num = detail.get("solicitation_number")
                ft = detail.get("full_title")
                if ft and len(ft) > len(title):
                    title = ft
                if detail.get("owner_organization") and not org_name:
                    org_name = detail["owner_organization"]

        fp = _fingerprint(title, org_name or "", row.get("closing_date") or "")
        results.append({
            "source_id": "",
            "external_id": solicitation_num,
            "title": title,
            "description_summary": description[:500] if description else None,
            "description_full": description,
            "status": "open",
            "country": "CA",
            "region": row.get("region"),
            "location_raw": row.get("location_raw") or "Canada",
            "posted_date": row.get("posted_date"),
            "closing_date": row.get("closing_date"),
            "category": category or "Procurement",
            "solicitation_number": solicitation_num,
            "currency": "CAD",
            "contact_name": contact_name,
            "contact_email": contact_email,
            "source_url": url,
            "has_documents": True,
            "organization_name": org_name,
            "fingerprint": fp,
            "raw_data": {
                "parser_version": "merx_agent_v2_playwright",
                "solicitation_number": solicitation_num,
                "fetch_timestamp": datetime.now(timezone.utc).isoformat(),
            },
        })

    return results


# ─── Main ───────────────────────────────────────────────


def check_config() -> bool:
    ok = True
    if not CLOUD_API_URL:
        log("ERROR: CLOUD_API_URL not set"); ok = False
    if not AGENT_API_KEY:
        log("ERROR: AGENT_API_KEY not set"); ok = False
    if not MERX_EMAIL or not MERX_PASSWORD:
        log("ERROR: MERX_EMAIL / MERX_PASSWORD not set"); ok = False
    return ok


def main() -> None:
    parser = argparse.ArgumentParser(description="BidToGo MERX Agent (Playwright)")
    parser.add_argument("--dry-run", action="store_true", help="Crawl but don't upload")
    parser.add_argument("--status", action="store_true", help="Check cloud connectivity")
    parser.add_argument("--verify", action="store_true", help="Login + verify private page access")
    parser.add_argument("--headed", action="store_true", help="Show browser window")
    parser.add_argument("--force-logout", action="store_true", help="Clear sessions before login")
    parser.add_argument("--retry-delay", type=int, default=30, help="Seconds between login retries (default 30)")
    args = parser.parse_args()

    log("BidToGo MERX Agent v2 (Playwright) starting")

    if not check_config():
        sys.exit(1)

    cloud = CloudClient()

    if args.status:
        cloud.check_health()
        sys.exit(0)

    # Launch browser
    browser = MerxBrowser(headless=not args.headed)

    try:
        # Pre-login logout if requested
        if args.force_logout:
            browser.force_logout()

        # Login
        if not browser.login(retry_delay=args.retry_delay):
            log("MERX login failed — aborting")
            sys.exit(1)

        # Verify mode
        if args.verify:
            report = browser.verify_access()
            log("Verification complete: %s", json.dumps(report, indent=2))
            sys.exit(0 if report.get("listing") else 1)

        # Request job
        log("Requesting job from cloud...")
        job = cloud.create_job()
        if not job:
            log("No jobs available — exiting")
            sys.exit(0)

        run_id = job["run_id"]
        source_id = job["source_id"]
        config = job.get("crawl_config", {})
        log("Job: run=%s source=%s (%s)", run_id, source_id, job["source_name"])

        cloud.update_status(run_id, "running")

        # Crawl
        log("Starting MERX crawl...")
        opps, stats = crawl_merx(browser, config)

        if args.dry_run:
            log("Dry run — %d opps found, not uploading", len(opps))
            for o in opps[:10]:
                log("  %s | %s | %s", o["title"][:55], o.get("region", "?"), o.get("closing_date", "?"))
            sys.exit(0)

        # Upload
        BATCH = 50
        created = updated = skipped = errs = 0
        for i in range(0, len(opps), BATCH):
            batch = opps[i:i + BATCH]
            log("Uploading %d-%d of %d...", i + 1, min(i + BATCH, len(opps)), len(opps))
            r = cloud.upload_opportunities(run_id, source_id, batch)
            created += r.get("created", 0)
            updated += r.get("updated", 0)
            skipped += r.get("skipped", 0)
            errs += r.get("errors", 0)

        cloud.update_status(
            run_id, "completed",
            pages_crawled=stats.listing_pages,
            opportunities_found=len(opps),
            opportunities_created=created,
            opportunities_updated=updated,
            opportunities_skipped=skipped,
            metadata={
                "agent": "merx_agent_v2_playwright",
                "detail_pages": stats.detail_pages,
                "crawl_errors": stats.errors,
                "upload_errors": errs,
            },
        )
        log("Done! created=%d updated=%d skipped=%d errors=%d", created, updated, skipped, errs)

    finally:
        browser.close()


if __name__ == "__main__":
    main()
