# Database Schema Design — LeadHarvest

## Overview

PostgreSQL 16 with Prisma ORM. All timestamps in UTC. UUIDs for primary keys.
JSONB columns for semi-structured data (crawl configs, relevance breakdowns, raw payloads).
Full-text search via `tsvector` generated column on opportunities.

---

## Entity Relationship Summary

```
users ─────────┬──── notes
               ├──── saved_searches ──── alerts
               └──── audit_logs

sources ───────┬──── source_runs
               └──── opportunities ──┬──── opportunity_documents
                                     ├──── opportunity_tags ──── tags
                                     ├──── notes
                                     └──── alerts

organizations ────── opportunities
```

---

## Table Definitions

### 1. `users`

Single-tenant admin users for MVP.

| Column | Type | Constraints | Notes |
|--------|------|------------|-------|
| id | UUID | PK, default gen_random_uuid() | |
| email | VARCHAR(255) | UNIQUE, NOT NULL | Login identifier |
| password_hash | VARCHAR(255) | NOT NULL | bcrypt hash |
| name | VARCHAR(255) | NOT NULL | Display name |
| role | ENUM('admin','viewer') | NOT NULL, default 'admin' | |
| created_at | TIMESTAMPTZ | NOT NULL, default now() | |
| updated_at | TIMESTAMPTZ | NOT NULL, auto-update | |

**Indexes**: `UNIQUE(email)`

---

### 2. `sources`

Registry of public data sources to crawl.

| Column | Type | Constraints | Notes |
|--------|------|------------|-------|
| id | UUID | PK | |
| name | VARCHAR(255) | NOT NULL | Human-readable name |
| source_type | ENUM | NOT NULL | bid_portal, municipal, school_board, housing_authority, university, hospital, construction, aggregator, other |
| base_url | TEXT | NOT NULL | Root URL for crawling |
| country | VARCHAR(2) | NOT NULL | ISO 3166-1 alpha-2 (CA, US) |
| region | VARCHAR(100) | | Province or state |
| city | VARCHAR(255) | | |
| crawl_config | JSONB | NOT NULL, default '{}' | Selectors, pagination rules, headers |
| frequency | ENUM | NOT NULL, default 'daily' | hourly, daily, weekly, manual |
| is_active | BOOLEAN | NOT NULL, default true | |
| last_crawled_at | TIMESTAMPTZ | | |
| last_run_status | ENUM | | success, partial, failed |
| category_tags | TEXT[] | default '{}' | |
| notes | TEXT | | Admin notes |
| robots_txt_cache | TEXT | | Cached robots.txt content |
| robots_txt_fetched_at | TIMESTAMPTZ | | |
| created_at | TIMESTAMPTZ | NOT NULL | |
| updated_at | TIMESTAMPTZ | NOT NULL | |

**Indexes**:
- `idx_sources_active` on `(is_active)` WHERE is_active = true
- `idx_sources_country_region` on `(country, region)`
- `idx_sources_type` on `(source_type)`

**crawl_config JSONB structure**:
```json
{
  "listing_url": "https://example.com/bids?page={page}",
  "listing_selector": "table.bids tbody tr",
  "detail_url_selector": "td:first-child a",
  "pagination": {
    "type": "page_param",
    "param": "page",
    "max_pages": 10
  },
  "fields": {
    "title": "h1.bid-title",
    "description": ".bid-description",
    "closing_date": ".closing-date",
    "solicitation_number": ".bid-number",
    "status": ".bid-status"
  },
  "rate_limit_seconds": 3,
  "headers": {},
  "encoding": "utf-8"
}
```

---

### 3. `source_runs`

Execution log for each crawl attempt.

| Column | Type | Constraints | Notes |
|--------|------|------------|-------|
| id | UUID | PK | |
| source_id | UUID | FK → sources.id, NOT NULL | |
| status | ENUM | NOT NULL | pending, running, completed, failed, cancelled |
| started_at | TIMESTAMPTZ | | |
| completed_at | TIMESTAMPTZ | | |
| duration_ms | INTEGER | | Computed from start/complete |
| pages_crawled | INTEGER | default 0 | |
| opportunities_found | INTEGER | default 0 | Total parsed |
| opportunities_created | INTEGER | default 0 | New records |
| opportunities_updated | INTEGER | default 0 | Existing records updated |
| opportunities_skipped | INTEGER | default 0 | Duplicates skipped |
| error_message | TEXT | | |
| error_details | JSONB | | Stack trace, context |
| metadata | JSONB | default '{}' | Any extra runtime info |
| triggered_by | ENUM | NOT NULL, default 'schedule' | schedule, manual, retry |
| created_at | TIMESTAMPTZ | NOT NULL | |

**Indexes**:
- `idx_source_runs_source_status` on `(source_id, status)`
- `idx_source_runs_created` on `(created_at DESC)`

---

### 4. `organizations`

Normalized registry of issuing organizations.

| Column | Type | Constraints | Notes |
|--------|------|------------|-------|
| id | UUID | PK | |
| name | VARCHAR(500) | NOT NULL | |
| name_normalized | VARCHAR(500) | NOT NULL | Lowercase, trimmed for matching |
| org_type | ENUM | | government, education, healthcare, housing, commercial, non_profit, other |
| country | VARCHAR(2) | | |
| region | VARCHAR(100) | | |
| city | VARCHAR(255) | | |
| website | TEXT | | |
| created_at | TIMESTAMPTZ | NOT NULL | |
| updated_at | TIMESTAMPTZ | NOT NULL | |

**Indexes**:
- `idx_organizations_name_normalized` on `(name_normalized)`
- `UNIQUE(name_normalized, country, region)` — dedup constraint

---

### 5. `opportunities`

Core table — every bid, tender, RFP, or project listing.

| Column | Type | Constraints | Notes |
|--------|------|------------|-------|
| id | UUID | PK | |
| source_id | UUID | FK → sources.id, NOT NULL | |
| source_run_id | UUID | FK → source_runs.id | Which crawl found this |
| organization_id | UUID | FK → organizations.id | Nullable until matched |
| external_id | VARCHAR(500) | | Source-specific bid/tender ID |
| title | TEXT | NOT NULL | |
| description_summary | TEXT | | First 500 chars or AI summary |
| description_full | TEXT | | Complete description text |
| status | ENUM | NOT NULL, default 'unknown' | open, closed, awarded, cancelled, archived, unknown |
| country | VARCHAR(2) | | CA, US |
| region | VARCHAR(100) | | Province or state |
| city | VARCHAR(255) | | |
| location_raw | TEXT | | Original location string |
| posted_date | DATE | | |
| closing_date | TIMESTAMPTZ | | With time for precision |
| project_type | VARCHAR(255) | | |
| category | VARCHAR(255) | | |
| solicitation_number | VARCHAR(255) | | |
| estimated_value | DECIMAL(15,2) | | |
| currency | VARCHAR(3) | default 'USD' | USD, CAD |
| contact_name | VARCHAR(255) | | |
| contact_email | VARCHAR(255) | | |
| contact_phone | VARCHAR(50) | | |
| source_url | TEXT | NOT NULL | Direct URL to original listing |
| has_documents | BOOLEAN | default false | |
| mandatory_site_visit | TEXT | | Date/details if applicable |
| pre_bid_meeting | TEXT | | Date/details if applicable |
| addenda_count | INTEGER | default 0 | |
| keywords_matched | TEXT[] | default '{}' | Which keywords hit |
| relevance_score | INTEGER | NOT NULL, default 0 | 0–100 composite score |
| relevance_breakdown | JSONB | default '{}' | Explanation of score |
| raw_data | JSONB | | Original extracted payload |
| fingerprint | VARCHAR(64) | NOT NULL | SHA-256 for dedup |
| search_vector | TSVECTOR | GENERATED | Full-text search column |
| created_at | TIMESTAMPTZ | NOT NULL | |
| updated_at | TIMESTAMPTZ | NOT NULL | |

**Indexes**:
- `UNIQUE(source_id, external_id)` WHERE external_id IS NOT NULL — source-level dedup
- `UNIQUE(fingerprint)` — content-level dedup
- `idx_opportunities_status` on `(status)` WHERE status = 'open'
- `idx_opportunities_country_region` on `(country, region)`
- `idx_opportunities_closing_date` on `(closing_date)` WHERE closing_date IS NOT NULL
- `idx_opportunities_posted_date` on `(posted_date DESC)`
- `idx_opportunities_relevance` on `(relevance_score DESC)`
- `idx_opportunities_source` on `(source_id)`
- `idx_opportunities_org` on `(organization_id)`
- `idx_opportunities_search` GIN on `(search_vector)` — full-text search
- `idx_opportunities_keywords` GIN on `(keywords_matched)` — array search
- `idx_opportunities_raw_data` GIN on `(raw_data)` — JSONB queries

**Generated column**:
```sql
search_vector TSVECTOR GENERATED ALWAYS AS (
  setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
  setweight(to_tsvector('english', coalesce(description_summary, '')), 'B') ||
  setweight(to_tsvector('english', coalesce(description_full, '')), 'C')
) STORED
```

---

### 6. `opportunity_documents`

Document links attached to opportunities.

| Column | Type | Constraints | Notes |
|--------|------|------------|-------|
| id | UUID | PK | |
| opportunity_id | UUID | FK → opportunities.id, NOT NULL, CASCADE | |
| title | VARCHAR(500) | | |
| url | TEXT | NOT NULL | |
| file_type | VARCHAR(50) | | pdf, doc, xlsx, etc. |
| file_size_bytes | INTEGER | | If available |
| created_at | TIMESTAMPTZ | NOT NULL | |

**Indexes**: `idx_opp_docs_opportunity` on `(opportunity_id)`

---

### 7. `tags`

Reusable tag definitions.

| Column | Type | Constraints | Notes |
|--------|------|------------|-------|
| id | UUID | PK | |
| name | VARCHAR(100) | NOT NULL | |
| category | VARCHAR(50) | NOT NULL | project_type, industry, building_type, product_type |
| created_at | TIMESTAMPTZ | NOT NULL | |

**Indexes**: `UNIQUE(name, category)`

---

### 8. `opportunity_tags`

Many-to-many join between opportunities and tags.

| Column | Type | Constraints | Notes |
|--------|------|------------|-------|
| opportunity_id | UUID | FK → opportunities.id, CASCADE | |
| tag_id | UUID | FK → tags.id, CASCADE | |

**Primary Key**: `(opportunity_id, tag_id)`

---

### 9. `saved_searches`

Persisted search configurations for quick access and alerting.

| Column | Type | Constraints | Notes |
|--------|------|------------|-------|
| id | UUID | PK | |
| user_id | UUID | FK → users.id, NOT NULL | |
| name | VARCHAR(255) | NOT NULL | |
| filters | JSONB | NOT NULL | Serialized filter state |
| notify_enabled | BOOLEAN | default false | |
| notify_frequency | ENUM | default 'daily' | daily, weekly, immediate |
| last_notified_at | TIMESTAMPTZ | | |
| result_count | INTEGER | | Cached count of matches |
| created_at | TIMESTAMPTZ | NOT NULL | |
| updated_at | TIMESTAMPTZ | NOT NULL | |

**Indexes**: `idx_saved_searches_user` on `(user_id)`

**filters JSONB structure**:
```json
{
  "keyword": "blinds renovation",
  "status": ["open"],
  "country": "CA",
  "regions": ["Ontario", "British Columbia"],
  "cities": [],
  "organizations": [],
  "sources": [],
  "categories": ["construction", "renovation"],
  "posted_after": "2025-01-01",
  "posted_before": null,
  "closing_after": "2025-06-01",
  "closing_before": null,
  "min_relevance": 50,
  "sort": "relevance_desc"
}
```

---

### 10. `alerts`

Notifications generated by the system.

| Column | Type | Constraints | Notes |
|--------|------|------------|-------|
| id | UUID | PK | |
| user_id | UUID | FK → users.id, NOT NULL | |
| saved_search_id | UUID | FK → saved_searches.id | Nullable |
| opportunity_id | UUID | FK → opportunities.id | Nullable |
| alert_type | ENUM | NOT NULL | new_match, closing_soon, source_error, digest |
| title | VARCHAR(500) | NOT NULL | |
| message | TEXT | | |
| is_read | BOOLEAN | default false | |
| created_at | TIMESTAMPTZ | NOT NULL | |

**Indexes**:
- `idx_alerts_user_unread` on `(user_id)` WHERE is_read = false
- `idx_alerts_created` on `(created_at DESC)`

---

### 11. `notes`

User-created notes on opportunities.

| Column | Type | Constraints | Notes |
|--------|------|------------|-------|
| id | UUID | PK | |
| user_id | UUID | FK → users.id, NOT NULL | |
| opportunity_id | UUID | FK → opportunities.id, NOT NULL, CASCADE | |
| content | TEXT | NOT NULL | |
| created_at | TIMESTAMPTZ | NOT NULL | |
| updated_at | TIMESTAMPTZ | NOT NULL | |

**Indexes**: `idx_notes_opportunity` on `(opportunity_id)`

---

### 12. `audit_logs`

Immutable log of administrative actions.

| Column | Type | Constraints | Notes |
|--------|------|------------|-------|
| id | UUID | PK | |
| user_id | UUID | FK → users.id | Nullable for system actions |
| action | VARCHAR(100) | NOT NULL | source.created, crawl.triggered, etc. |
| entity_type | VARCHAR(50) | | source, opportunity, saved_search |
| entity_id | UUID | | |
| metadata | JSONB | default '{}' | Before/after state, context |
| ip_address | VARCHAR(45) | | |
| created_at | TIMESTAMPTZ | NOT NULL | |

**Indexes**:
- `idx_audit_entity` on `(entity_type, entity_id)`
- `idx_audit_created` on `(created_at DESC)`

---

## Deduplication Strategy

### Level 1: Source-level dedup
- `UNIQUE(source_id, external_id)` — same source, same bid number = same record
- On conflict: UPDATE fields that may have changed (status, closing_date, addenda_count, description)

### Level 2: Content-level dedup
- `fingerprint` = SHA-256 of normalized canonical: `lower(title) + org_name + closing_date + source_url`
- Catches same opportunity posted on multiple aggregator sites
- On conflict: keep the record with the most complete data; link others as `related`

### Level 3: Fuzzy dedup (post-MVP)
- Trigram similarity on `title` with `pg_trgm` extension
- Same org + similar title + same closing date within 3 days = likely duplicate
- Flag for manual review rather than auto-merge

---

## Full-Text Search Strategy

1. **Generated tsvector column** with weighted components:
   - Weight A: title (highest priority)
   - Weight B: description_summary
   - Weight C: description_full
2. **GIN index** on the tsvector column for fast lookup
3. **Search query**: `websearch_to_tsquery('english', :query)` for natural language queries
4. **Ranking**: `ts_rank_cd(search_vector, query)` combined with `relevance_score` for composite ordering
5. **Highlighting**: `ts_headline()` for search result snippets

---

## Migration Strategy

- Prisma Migrate for schema versioning
- Seed script for: default admin user, initial tags, example sources
- Raw SQL migration for: generated columns, custom indexes, GIN indexes, tsvector
