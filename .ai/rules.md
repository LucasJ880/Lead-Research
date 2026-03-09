# BidToGo — Architectural Rules

These rules define the structural integrity of the system. They must never be violated, regardless of feature urgency or convenience.

---

## 1. Project Mission

BidToGo collects publicly available procurement opportunities across North America and scores them for relevance to the window covering industry. Every architectural decision must serve this mission:

- **Speed to insight** — A business owner should go from "open dashboard" to "reviewing scored leads" in under 60 seconds.
- **Data freshness** — Opportunities must be crawled at least daily, with closing dates tracked to prevent missed deadlines.
- **Trust in scoring** — The relevance score must be transparent and explainable. Users must understand why a score is high or low.
- **Ethical data collection** — All data must come from public, authorized sources. No exceptions.

---

## 2. System Architecture Rules

### 2.1 Data Pipeline Is Sacred

All opportunity data must flow through this pipeline in order:

```
source website → crawler → parser → normalizer → scorer → deduplicator → database → API → frontend
```

**Rules:**
- No module may bypass the pipeline. A scraper must never write directly to the database without passing through normalization and scoring.
- The API layer must never modify opportunity data directly. It reads from the database and writes user-generated data (notes, saved searches).
- The frontend must never fetch data from sources directly. All data comes through the API layer.

### 2.2 Service Boundaries

The system has two runtime services with a shared database:

| Service | Runtime | Responsibility |
|---------|---------|----------------|
| **Web App** | Node.js (Next.js) | Dashboard UI, API routes, authentication, database reads/writes via Prisma |
| **Scraper Service** | Python (FastAPI + Celery) | Crawling, parsing, normalizing, scoring, deduplication, database writes via SQLAlchemy |

**Rules:**
- The web app communicates with the scraper service only via HTTP (FastAPI endpoints). Never via shared memory, files, or direct function calls.
- Both services connect to the same PostgreSQL database. Schema changes must be coordinated — Prisma owns the schema definition; Python uses SQLAlchemy for reads/writes only.
- Redis is a shared broker. Both services may read/write to Redis, but must use namespaced keys to avoid collisions.

### 2.3 Technology Ownership

| Concern | Owner | Rationale |
|---------|-------|-----------|
| Database schema | Prisma (apps/web/prisma/schema.prisma) | Single source of truth for migrations |
| Full-text search setup | Raw SQL (apps/web/prisma/setup-search.sql) | Prisma cannot define tsvector generated columns |
| API endpoints | Next.js API Routes (apps/web/src/app/api/) | Co-located with frontend for MVP simplicity |
| Scraping logic | Python (services/scraper/src/) | Python has the best scraping ecosystem |
| Relevance scoring | Python (services/scraper/src/utils/scorer.py) | Runs during crawl pipeline, before database insertion |
| UI components | React + shadcn/ui (apps/web/src/components/) | Tailwind-native, accessible, owned (not a dependency) |

---

## 3. Module Separation Rules

### 3.1 Scraper Modules

The scraper service is organized into clearly separated modules:

```
services/scraper/src/
├── api/          → FastAPI endpoints (HTTP interface only)
├── crawlers/     → Page fetching, pagination, rate limiting
├── parsers/      → HTML → structured data extraction
├── utils/        → Normalizer, scorer, deduplicator
├── models/       → Pydantic data models
├── tasks/        → Celery task definitions and app config
└── core/         → Config, database connection, logging
```

**Rules:**
- Crawlers must not contain parsing logic. They fetch raw HTML and hand it to parsers.
- Parsers must not contain crawling logic. They receive HTML and return structured data.
- The normalizer must not contain scoring logic. It cleans data; the scorer evaluates it.
- The scorer must not contain database logic. It returns a score and breakdown; the pipeline writes to the database.
- The API layer (`api/`) must not contain business logic. It dispatches tasks and returns status.

### 3.2 Frontend Modules

```
apps/web/src/
├── app/api/         → API route handlers (data access only)
├── app/dashboard/   → Page components (presentation + data fetching)
├── components/ui/   → Reusable UI primitives (Button, Card, Badge, Input)
├── lib/             → Shared utilities (Prisma client, auth, helpers)
└── types/           → TypeScript interfaces shared across the app
```

**Rules:**
- API routes must not contain presentation logic. They return JSON.
- Page components must not contain direct database queries. They fetch from API routes via `fetch()`.
- UI components must be stateless and reusable. Business logic belongs in page components or hooks.
- TypeScript types in `types/` must match the API response shapes exactly. These are the contract between API and frontend.

---

## 4. Data Integrity Rules

### 4.1 Database Schema

- The Prisma schema at `apps/web/prisma/schema.prisma` is the single source of truth for the database structure.
- Schema changes require a clear rationale. Before modifying the schema, document: (a) what is changing, (b) why it is needed, (c) what existing data or queries are affected.
- Never drop columns or tables without first verifying that no code references them.
- All tables use UUIDs for primary keys, generated by `gen_random_uuid()`.
- All timestamps are stored in UTC using `TIMESTAMPTZ`.
- Nullable fields must have an explicit reason. Default to NOT NULL.

### 4.2 Deduplication

Deduplication is a two-layer system. Both layers must be maintained.

| Layer | Mechanism | Purpose |
|-------|-----------|---------|
| Source-level | `UNIQUE(source_id, external_id)` | Same source + same bid number = same record |
| Content-level | `UNIQUE(fingerprint)` — SHA-256 of `title + source_url` | Catches the same opportunity on different aggregator sites |

**Rules:**
- Every opportunity must have a fingerprint before insertion.
- The fingerprint algorithm must not change without a migration plan for existing records.
- Upsert behavior: on fingerprint conflict, existing records are preserved (no data loss).

### 4.3 Full-Text Search

- The `search_vector` tsvector column is a PostgreSQL generated column, not managed by Prisma.
- It is defined in `apps/web/prisma/setup-search.sql` and must be re-applied after any schema migration that recreates the opportunities table.
- Search weights: title (A), description_summary (B), description_full (C).
- API keyword search uses `websearch_to_tsquery('english', $keyword)` — always parameterized, never string-interpolated.

### 4.4 Relevance Scoring

- Scores are integers in the range 0–100, stored in `relevance_score`.
- The scoring breakdown is stored in `relevance_breakdown` as JSONB for transparency.
- The keyword dictionaries in `services/scraper/src/utils/scorer.py` are the authoritative source for scoring weights.
- Keyword changes affect all future scores. They do not retroactively change existing scores unless a re-scoring job is run.

---

## 5. Backward Compatibility Rules

### 5.1 API Contracts

- API response shapes are defined in `apps/web/src/types/index.ts`. These types serve as the contract between backend and frontend.
- Existing fields in API responses must not be removed or renamed without updating all consuming frontend components.
- New fields may be added to API responses without breaking changes.
- Query parameters may be added but existing parameters must not change meaning.

### 5.2 Database Migrations

- Additive changes (new columns, new tables, new indexes) are safe.
- Destructive changes (dropping columns, renaming columns, changing types) require a migration plan: (a) add new column, (b) backfill data, (c) update code, (d) drop old column.
- Never use `prisma db push` in production. Use `prisma migrate` for versioned migrations.

### 5.3 Scraper Adapters

- Adding a new crawler/parser is always safe — it's a new file in `crawlers/` or `parsers/`.
- Modifying an existing parser must not break the output schema (`OpportunityCreate` Pydantic model).
- Source configurations in `data/sources.yaml` may be added or modified without code changes.

---

## 6. Documentation Rules

### 6.1 What Must Be Documented

| Change Type | Required Documentation |
|-------------|----------------------|
| New API endpoint | Add to README API table and describe query parameters |
| Schema change | Update `docs/DATABASE.md` and explain rationale |
| New scraper source | Add entry to `data/sources.yaml` with full metadata |
| Keyword list change | Note in commit message; explain scoring impact |
| Architecture change | Update `docs/architecture.md` with new diagrams/flows |
| New feature | Update PRD feature list in `docs/PRD.md` |

### 6.2 Documentation Locations

| File | Purpose |
|------|---------|
| `.ai/project_context.md` | Long-term project context for AI assistants |
| `.ai/rules.md` | This file — architectural rules |
| `.ai/coding_rules.md` | Code style and implementation patterns |
| `.ai/scraper_rules.md` | Scraping architecture and safety rules |
| `.ai/working_protocol.md` | How the AI assistant should behave |
| `docs/PRD.md` | Product requirements document |
| `docs/architecture.md` | System architecture and data flows |
| `docs/DATABASE.md` | Database schema documentation |
| `data/sources.yaml` | Source registry for scrapers |
| `README.md` | Quick start, API reference, project overview |
