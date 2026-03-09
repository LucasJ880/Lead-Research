# BidToGo — Scraper Rules

These rules govern the design, implementation, and operation of all data collection components.

---

## 1. Scraper Philosophy

BidToGo collects opportunity data from publicly accessible procurement portals. The scraper is a guest on these websites — it must behave politely, transparently, and within the boundaries of what is authorized.

**Core principles:**

- **Public only.** If a page requires login, CAPTCHA, or any form of access control, the scraper must not access it.
- **Transparent.** The scraper identifies itself with an honest User-Agent string. It does not impersonate browsers or hide its nature.
- **Polite.** The scraper respects rate limits, robots.txt, and terms of service. It fetches at a sustainable pace that does not burden the target server.
- **Robust.** The scraper handles errors gracefully. A single failed page must not crash the entire crawl run.
- **Traceable.** Every crawl run is logged with timing, page counts, opportunity counts, and errors. If something goes wrong, the logs tell you what happened and why.

---

## 2. Crawler Design

### 2.1 Architecture

Every crawler extends `BaseCrawler` in `services/scraper/src/crawlers/base.py`. The base class provides:

- HTTP session management with configurable timeout, retries, and headers
- Rate limiting (configurable delay between requests, default 3 seconds)
- robots.txt checking and caching
- Logging for every request

### 2.2 Crawler Responsibilities

A crawler is responsible for **fetching pages and handling navigation**. It does not parse HTML.

| Crawler Does | Crawler Does NOT |
|-------------|-----------------|
| Fetch listing pages | Parse HTML structure |
| Handle pagination (page params, next links, infinite scroll endpoints) | Extract individual fields |
| Respect rate limits between requests | Compute relevance scores |
| Check robots.txt before fetching | Write directly to the database |
| Handle HTTP errors (retry, skip, log) | Normalize dates or locations |
| Return raw HTML to the pipeline | Apply business logic |

### 2.3 Crawler Configuration

Each source has a `crawl_config` JSON stored in the database or in `data/sources.yaml`. This config drives the crawler behavior:

```yaml
crawl_config:
  listing_url: "https://example.com/bids?page={page}"
  pagination:
    type: page_param        # page_param | next_link | offset | none
    param: page
    max_pages: 10
  rate_limit_seconds: 3
  timeout_seconds: 30
  max_retries: 3
  headers: {}
  encoding: utf-8
```

**Rules:**
- Pagination parameters, URLs, and headers must live in configuration — not hardcoded in crawler code.
- A generic crawler should handle 80% of sources via configuration alone. Source-specific crawlers are only needed for sites with unusual navigation patterns.
- The maximum number of pages per crawl run must be configurable and enforced. Default: 20 pages.

### 2.4 Rate Limiting

- Default: 3-second delay between requests to the same domain.
- Configurable per source via `rate_limit_seconds` in crawl config.
- Minimum enforced delay: 1 second. The system must not allow sub-second request rates.
- If a source returns HTTP 429 (Too Many Requests), the crawler must back off exponentially (double the delay, retry after wait).

---

## 3. Parser Design

### 3.1 Architecture

Every parser extends `BaseParser` in `services/scraper/src/parsers/base.py`. Parsers receive raw HTML and return structured data.

### 3.2 Parser Responsibilities

| Parser Does | Parser Does NOT |
|------------|-----------------|
| Accept raw HTML string or BeautifulSoup object | Fetch pages from the internet |
| Extract structured fields using CSS selectors or XPath | Handle pagination |
| Return a list of Pydantic models (`OpportunityCreate`) | Write to the database |
| Handle missing fields gracefully (return None, not crash) | Compute relevance scores |
| Log warnings for unexpected HTML structure | Manage HTTP sessions |

### 3.3 Required Output Fields

Every parser must attempt to extract these fields. Fields marked as required must always have a value; optional fields may be `None`.

| Field | Required | Description |
|-------|----------|-------------|
| `title` | Yes | Opportunity title or name |
| `source_url` | Yes | Direct URL to the original listing |
| `external_id` | No (recommended) | Source-specific identifier (bid number, solicitation number) |
| `organization` | No | Issuing organization name |
| `description` | No | Full or summary description text |
| `location_raw` | No | Raw location string as displayed on the source |
| `country` | No | ISO 3166-1 alpha-2 code (CA, US) |
| `region` | No | Province or state |
| `city` | No | City name |
| `posted_date` | No | When the opportunity was published |
| `closing_date` | No | Submission deadline |
| `status` | No | open, closed, awarded, cancelled, unknown |
| `estimated_value` | No | Estimated contract value |
| `currency` | No | CAD or USD |
| `category` | No | Opportunity category |
| `contact_name` | No | Contact person name |
| `contact_email` | No | Contact email |
| `contact_phone` | No | Contact phone number |
| `documents` | No | List of document URLs attached to the listing |

### 3.4 Selector Placement

- CSS selectors and XPath expressions must be defined as constants at the top of the parser file or loaded from the source's `crawl_config`.
- Never embed selectors inline within parsing functions. This makes them impossible to update when the source site changes its HTML.
- When a source website changes its HTML structure, only the selector constants need updating — not the parsing logic.

```python
# Good: selectors as module-level constants
TITLE_SELECTOR = "h1.bid-title"
DATE_SELECTOR = ".closing-date"
DESCRIPTION_SELECTOR = ".bid-description"

# Bad: selectors embedded in logic
def parse(self, soup):
    title = soup.select_one("h1.bid-title").text  # Don't do this
```

---

## 4. Normalization Rules

After parsing, raw data passes through the normalizer (`services/scraper/src/utils/normalizer.py`) before scoring and storage.

### 4.1 Date Normalization

- All dates are parsed into Python `datetime` objects using `python-dateutil` for maximum format flexibility.
- Closing dates include timezone information. If no timezone is specified, assume the source's local timezone (US/Canada).
- Posted dates are stored as date-only (no time component).
- If a date cannot be parsed, log a warning and store `None` — never store a malformed date string.

### 4.2 Location Normalization

- Country must be a 2-letter ISO code: `CA` or `US`.
- Region must be a province/state abbreviation: `ON`, `BC`, `AB`, `QC`, `CA`, `TX`, `FL`, `NY`, etc.
- City names are title-cased and trimmed of whitespace.
- The original location string is preserved in `location_raw` for debugging and display.

### 4.3 Text Normalization

- Titles are stripped of excess whitespace, HTML entities, and control characters.
- Descriptions have HTML tags stripped. Paragraph breaks are preserved as newlines.
- Unicode is normalized to NFC form.

### 4.4 Status Normalization

Raw status strings from sources must be mapped to the `OpportunityStatus` enum:

| Raw Values | Normalized Status |
|-----------|------------------|
| "open", "active", "accepting bids", "published" | `open` |
| "closed", "expired", "deadline passed" | `closed` |
| "awarded", "contract awarded", "selected" | `awarded` |
| "cancelled", "withdrawn", "retracted" | `cancelled` |
| Anything else or missing | `unknown` |

---

## 5. Safety Rules

These rules are non-negotiable. Violating them is a project-level incident.

### 5.1 Prohibited Actions

The scraper must **never**:

- Access pages behind a login form or authentication wall
- Submit credentials, cookies, or session tokens obtained from a user's browser
- Solve or bypass CAPTCHAs (including using CAPTCHA-solving services)
- Access pages behind a paywall or subscription gate
- Use private or undocumented APIs (unless explicitly documented as public)
- Impersonate a human user by spoofing cookies, referrers, or browser fingerprints
- Scrape personal data (email addresses, phone numbers, home addresses of private individuals)
- Override or ignore robots.txt disallow directives
- Send requests faster than the configured rate limit

### 5.2 Required Safety Checks

Before every crawl run:

1. **Check robots.txt** — Fetch and parse the target domain's `robots.txt`. Cache it for 24 hours. If the target path is disallowed, skip it.
2. **Check rate limit** — Enforce the configured delay between requests. If no config exists, use the 3-second default.
3. **Check domain** — Only crawl domains listed in the source registry (`data/sources.yaml` or the `sources` database table). Never follow links to unknown domains.
4. **Check page count** — Enforce the `max_pages` limit per crawl run. Stop when the limit is reached, even if more pages exist.

### 5.3 User-Agent

The crawler must identify itself with a transparent User-Agent string:

```
BidToGo/1.0 (+https://bidtogo.ca/bot; bot@bidtogo.ca)
```

This string must include:
- The project name and version
- A URL where the operator can be contacted
- An email address for the operator

---

## 6. Logging Rules

### 6.1 Crawl Run Logging

Every crawl run must create a `source_runs` record in the database with:

| Field | When Set |
|-------|----------|
| `status: pending` | Task is dispatched |
| `status: running`, `started_at` | Crawl begins |
| `pages_crawled` | Incremented as each page is fetched |
| `opportunities_found` | Total parsed from HTML |
| `opportunities_created` | New records inserted |
| `opportunities_updated` | Existing records updated |
| `opportunities_skipped` | Duplicates skipped |
| `status: completed`, `completed_at`, `duration_ms` | Crawl finishes successfully |
| `status: failed`, `error_message`, `error_details` | Crawl fails |

### 6.2 Request Logging

Log every HTTP request made by the crawler at `INFO` level:

```
INFO  [merx_crawler] GET https://merx.com/bids?page=1 → 200 (1.2s, 45KB)
INFO  [merx_crawler] GET https://merx.com/bids?page=2 → 200 (1.5s, 38KB)
WARN  [merx_crawler] GET https://merx.com/bids?page=3 → 503 (retry 1/3)
```

### 6.3 Error Logging

Log errors at `ERROR` level with enough context to reproduce:

```
ERROR [merx_parser] Failed to parse opportunity: missing title selector
  url=https://merx.com/bids/12345
  html_snippet=<div class="bid-card">...
```

### 6.4 What Not to Log

- Never log full HTML responses (they're too large and may contain sensitive data).
- Never log credentials, API keys, or authentication tokens.
- Never log personal data from opportunity contacts in debug logs.

---

## 7. Adding a New Source

To add a new scraping source:

1. **Add entry to `data/sources.yaml`** with name, URL, country, region, type, and crawl config.
2. **Register in database** — Either via the dashboard Sources page or the seed script.
3. **Write a parser** — Create `services/scraper/src/parsers/{source_name}.py` extending `BaseParser`. Define selectors as constants at the top.
4. **Test with fixtures** — Save a sample HTML page in `services/scraper/tests/fixtures/` and write a unit test that verifies field extraction.
5. **Write a crawler (if needed)** — Only if the generic crawler cannot handle the source's pagination or navigation pattern. Most sources work with the generic crawler.
6. **Test end-to-end** — Run a manual crawl via the FastAPI endpoint and verify opportunities appear in the database with correct normalization and scoring.
7. **Document** — Add the source to `data/sources.yaml` and note any unusual behavior in the parser file.
