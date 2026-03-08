# LeadHarvest — System Architecture

---

## 1. High-Level Overview

LeadHarvest is a two-service platform with a shared database:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          DOCKER COMPOSE                                 │
│                                                                         │
│  ┌──────────────────────────────┐  ┌──────────────────────────────────┐ │
│  │      Next.js Web App         │  │     Python Scraper Service       │ │
│  │      (apps/web/)             │  │     (services/scraper/)          │ │
│  │                              │  │                                  │ │
│  │  ┌────────────────────────┐  │  │  ┌──────────┐  ┌────────────┐  │ │
│  │  │  Dashboard UI          │  │  │  │ FastAPI  │  │  Celery     │  │ │
│  │  │  (React + Tailwind)    │  │  │  │ API      │  │  Workers    │  │ │
│  │  ├────────────────────────┤  │  │  └────┬─────┘  └──────┬─────┘  │ │
│  │  │  API Routes            │  │  │       │               │        │ │
│  │  │  (Next.js handlers)    │  │  │  ┌────┴───────────────┴─────┐  │ │
│  │  └───────────┬────────────┘  │  │  │  Crawlers → Parsers      │  │ │
│  │              │                │  │  │  → Normalizers → Scorers │  │ │
│  └──────────────┼────────────────┘  │  └──────────────────────────┘  │ │
│                 │                    └───────────────┬────────────────┘ │
│                 │                                    │                  │
│           ┌─────┴────────────────────────────────────┴──────┐          │
│           │                PostgreSQL 16                      │          │
│           │   opportunities · sources · organizations         │          │
│           │   source_runs · saved_searches · notes · alerts   │          │
│           │   tags · audit_logs · users                       │          │
│           └──────────────────────┬───────────────────────────┘          │
│                                  │                                      │
│           ┌──────────────────────┴───────────────────────────┐          │
│           │                    Redis 7                         │          │
│           │   Celery task broker · rate-limit state · cache    │          │
│           └──────────────────────────────────────────────────┘          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Service Definitions

### 2.1 Next.js Web App (apps/web/)

**Runtime:** Node.js 18+
**Framework:** Next.js 14 (App Router)
**Port:** 3000

Responsibilities:
- Serve the dashboard UI (React + Tailwind CSS + shadcn/ui)
- Expose REST API endpoints for all frontend operations
- Manage authentication (NextAuth.js with JWT sessions)
- Query PostgreSQL via Prisma ORM
- Trigger scraper runs via HTTP calls to the Python FastAPI service

### 2.2 Python Scraper Service (services/scraper/)

**Runtime:** Python 3.9+
**Framework:** FastAPI (API) + Celery (task queue)
**Port:** 8001

Responsibilities:
- Expose an HTTP API for triggering crawl runs and checking status
- Execute crawl tasks via Celery workers
- Fetch, parse, normalize, score, and deduplicate opportunity data
- Write results to PostgreSQL via SQLAlchemy
- Manage crawl scheduling via Celery Beat

### 2.3 PostgreSQL 16

**Port:** 5433 (external) → 5432 (internal)

Shared database between both services. Prisma owns the schema definition. Features used:
- UUID primary keys via `gen_random_uuid()`
- TIMESTAMPTZ for all timestamps (UTC)
- Full-text search via `tsvector` generated column + GIN index
- JSONB columns for flexible data (crawl_config, relevance_breakdown, raw_data)
- Array columns (TEXT[]) for keywords_matched and category_tags
- Composite unique constraints for deduplication

### 2.4 Redis 7

**Port:** 6380 (external) → 6379 (internal)

Shared between both services:
- Celery task broker (task dispatch and result storage)
- Rate-limit state for crawlers
- Application cache (future use)

---

## 3. Data Flow

### 3.1 Crawl Pipeline

This is the core data pipeline. Every opportunity flows through these stages in order:

```
1. SOURCE WEBSITE
   │
   ▼
2. CRAWLER (services/scraper/src/crawlers/)
   │  • Checks robots.txt
   │  • Fetches listing pages with rate limiting
   │  • Handles pagination
   │  • Returns raw HTML
   │
   ▼
3. PARSER (services/scraper/src/parsers/)
   │  • Extracts structured data from HTML
   │  • Returns list of OpportunityCreate models
   │
   ▼
4. NORMALIZER (services/scraper/src/utils/normalizer.py)
   │  • Standardizes dates (ISO 8601)
   │  • Standardizes locations (country, region, city)
   │  • Cleans text (strip HTML, normalize whitespace)
   │  • Maps status to enum
   │
   ▼
5. SCORER (services/scraper/src/utils/scorer.py)
   │  • Matches title + description against keyword dictionaries
   │  • Applies org-type bonuses
   │  • Computes 0–100 relevance score
   │  • Generates explainable breakdown
   │
   ▼
6. DEDUPLICATOR (services/scraper/src/utils/dedup.py)
   │  • Generates SHA-256 fingerprint
   │  • Checks for existing records
   │  • Decides: insert, update, or skip
   │
   ▼
7. DATABASE (PostgreSQL)
   │  • Upsert opportunity record
   │  • tsvector auto-generated on insert/update
   │  • Source run stats updated
   │
   ▼
8. API (apps/web/src/app/api/)
   │  • Serves opportunities to the dashboard
   │  • Full-text search via tsvector
   │  • Filtering, sorting, pagination
   │
   ▼
9. DASHBOARD (apps/web/src/app/dashboard/)
      • User searches, filters, views, exports
```

### 3.2 Search Query Flow

```
1. User enters search terms and filters in the dashboard UI
2. Frontend sends GET /api/opportunities with query parameters
3. API route builds the query:
   ├─ If keyword present: raw SQL with websearch_to_tsquery() on search_vector
   └─ If no keyword: Prisma findMany with WHERE clauses
4. Additional filters applied: status, country, region, date ranges, minRelevance
5. Sort applied: newest (posted_date DESC), closing_soon (closing_date ASC), relevance (score DESC)
6. Paginated results returned with total count
7. Frontend renders opportunity list with scores, badges, and links
```

### 3.3 Export Flow

```
1. User applies filters and clicks "Export"
2. Frontend opens GET /api/exports?format=xlsx&{filters} in a new tab
3. API route queries all matching opportunities (up to 10,000 rows)
4. XLSX package generates a spreadsheet with formatted columns
5. File streamed to browser as download
```

---

## 4. Frontend Architecture

### 4.1 Page Structure

```
/ ─────────────────────── Landing page (redirects to /dashboard)
/login ────────────────── Authentication page
/dashboard ────────────── Overview: stat cards + recent opportunities
/dashboard/opportunities ─ Search/filter list with pagination + export
/dashboard/opportunities/[id] ─ Detail view: description, docs, notes, score
/dashboard/sources ────── Source management table
/dashboard/logs ───────── Crawl run history
/dashboard/saved-searches ─ Saved search management
```

### 4.2 Component Hierarchy

```
RootLayout (app/layout.tsx)
├── Providers (SessionProvider, QueryClientProvider)
└── DashboardLayout (app/dashboard/layout.tsx)
    ├── Sidebar (navigation, collapse toggle)
    ├── Header (search bar, notifications, user menu)
    └── Main Content Area
        └── Page Component (data fetching + presentation)
            ├── UI Primitives (Button, Card, Badge, Input)
            └── Data Display (tables, stat cards, detail sections)
```

### 4.3 Data Fetching Pattern

All dashboard pages are client components (`"use client"`) that fetch from API routes:

```typescript
const [data, setData] = useState(null);
const [loading, setLoading] = useState(true);

useEffect(() => {
  fetch("/api/endpoint")
    .then(res => res.json())
    .then(setData)
    .finally(() => setLoading(false));
}, [dependencies]);
```

---

## 5. API Architecture

### 5.1 Endpoint Map

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/stats` | Dashboard summary stats |
| GET | `/api/opportunities` | Search, filter, paginate opportunities |
| GET | `/api/opportunities/[id]` | Opportunity detail with relations |
| POST | `/api/opportunities/[id]/notes` | Add note to opportunity |
| GET | `/api/sources` | List all sources |
| POST | `/api/sources` | Create a source |
| GET | `/api/sources/[id]` | Source detail |
| PATCH | `/api/sources/[id]` | Update a source |
| DELETE | `/api/sources/[id]` | Delete a source |
| GET | `/api/source-runs` | Crawl run history |
| GET | `/api/exports` | Export opportunities (CSV/XLSX) |
| GET | `/api/saved-searches` | List saved searches |
| POST | `/api/saved-searches` | Create saved search |
| DELETE | `/api/saved-searches/[id]` | Delete saved search |

### 5.2 Response Conventions

**Paginated lists:**
```json
{
  "data": [...],
  "total": 150,
  "page": 1,
  "pageSize": 20,
  "totalPages": 8
}
```

**Single resources:** Returned directly as a JSON object.

**Errors:**
```json
{
  "error": "Description of what went wrong",
  "details": { ... }
}
```

---

## 6. Database Architecture

### 6.1 Core Tables

| Table | Records | Purpose |
|-------|---------|---------|
| `opportunities` | Growing (hundreds → thousands) | Every bid, tender, RFP, or project |
| `sources` | ~50–200 | Registry of procurement portals to crawl |
| `source_runs` | Growing | Crawl execution log |
| `organizations` | Growing | Normalized issuing organizations |
| `saved_searches` | ~10–50 per user | Persistent filter configurations |
| `notes` | Growing | User annotations on opportunities |
| `tags` | ~20–50 | Reusable category and product tags |
| `users` | 1–10 (MVP) | Admin accounts |
| `alerts` | Growing | System notifications |
| `audit_logs` | Growing | Administrative action history |

### 6.2 Key Indexes

| Index | Type | Purpose |
|-------|------|---------|
| `search_vector` GIN | Full-text | Natural-language search on title + description |
| `keywords_matched` GIN | Array | Find opportunities by matched keyword |
| `raw_data` GIN | JSONB | Query original scraped data |
| `(source_id, external_id)` UNIQUE | B-tree | Source-level deduplication |
| `(fingerprint)` UNIQUE | B-tree | Content-level deduplication |
| `relevance_score DESC` | B-tree | Sort by relevance |
| `closing_date` | B-tree | Sort by deadline |
| `posted_date DESC` | B-tree | Sort by recency |

### 6.3 Search Implementation

Full-text search uses a PostgreSQL generated column:

```sql
search_vector TSVECTOR GENERATED ALWAYS AS (
  setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
  setweight(to_tsvector('english', coalesce(description_summary, '')), 'B') ||
  setweight(to_tsvector('english', coalesce(description_full, '')), 'C')
) STORED
```

Queries use `websearch_to_tsquery('english', $keyword)` for natural-language parsing and `ts_rank_cd` for relevance ordering.

---

## 7. Security Architecture

| Layer | Mechanism |
|-------|-----------|
| Authentication | NextAuth.js with bcrypt-hashed credentials, JWT sessions (7-day expiry) |
| API authorization | Session-based (MVP); all routes accessible to authenticated users |
| Input validation | Zod schemas on all API request bodies |
| SQL injection | Prisma parameterized queries; raw SQL uses `$1, $2, ...` placeholders |
| CORS | Restricted to application origin |
| Secrets | Environment variables only; `.env` not committed to repo |
| Scraper isolation | Separate container with no inbound internet access |

---

## 8. Deployment Architecture

### 8.1 Local Development

```bash
docker compose up -d postgres redis    # Infrastructure
cd apps/web && npx next dev            # Web app on :3000
cd services/scraper && uvicorn ...     # Scraper API on :8001
celery -A src.tasks.celery_app worker  # Celery workers
```

### 8.2 Production Path

| Component | Recommended Platform |
|-----------|---------------------|
| Next.js frontend + API | Vercel or Railway |
| PostgreSQL | Neon, Supabase, or AWS RDS |
| Redis | Upstash or AWS ElastiCache |
| Scraper workers | Railway, Render, or AWS ECS containers |
| Celery Beat scheduler | Same container as scraper, or dedicated |

### 8.3 Scaling Strategy

| Bottleneck | Current | Scale Solution |
|-----------|---------|----------------|
| Search performance | PostgreSQL tsvector | Add Meilisearch or Elasticsearch |
| Scraper throughput | Single Celery worker | Horizontal scaling (multiple workers) |
| API throughput | Next.js API routes | Extract to NestJS, add load balancer |
| Database load | Single PostgreSQL | Read replicas, PgBouncer |
| Frontend | SSR + client | CDN, Redis caching |
