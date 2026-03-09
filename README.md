# LeadHarvest — Opportunity Intelligence Platform

A production-grade, BidPrime-style procurement intelligence system for the North American window covering, blinds, curtains, textile, and interior furnishing industry. Collects, normalizes, scores, analyzes, and surfaces public tender opportunities from 300+ registered sources across Canada and the United States.

## What It Does

- **Aggregates** public bids, tenders, RFPs, and procurement notices from MERX, Biddingo, SAM.gov, municipal portals, school boards, housing authorities, and more
- **Normalizes** raw data into a consistent schema with location, dates, contacts, documents, and categories
- **Scores** every opportunity using a multi-tier relevance engine (primary, secondary, contextual, negative keywords + semantic matching) with 0–100 scoring and 4-tier bucketing
- **Authenticates** with paid MERX accounts to download tender documents (PDFs, DOCX, specs)
- **Extracts** text content from downloaded documents (PDF and DOCX parsing)
- **Analyzes** tenders using AI (OpenAI GPT) to assess scope, technical requirements, qualifications, risk factors, feasibility, and China sourcing viability
- **Surfaces** results in a real-time dashboard with full-text search, smart filters, business workflow, source analytics, and AI intelligence panels
- **Exports** filtered results to CSV or Excel

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│                    Next.js 14 (App Router)                │
│   Dashboard · Opportunities · Sources · Intelligence      │
│   Logs · Settings · Saved Searches · Export               │
├──────────────────────────────────────────────────────────┤
│             API Layer (Next.js API Routes)                 │
│   /api/stats · /api/opportunities · /api/intelligence     │
│   /api/sources · /api/exports · /api/saved-searches       │
├──────────────┬───────────────────────────────────────────┤
│  Prisma ORM  │       Python Scraper Service               │
│  (Node.js)   │   FastAPI + Celery + BeautifulSoup         │
│              │   MERX Auth · Biddingo API · Document DL   │
│              │   Relevance Engine · Intelligence Pipeline  │
├──────────────┴───────────────────────────────────────────┤
│                   PostgreSQL 16                            │
│   tsvector FTS · GIN indexes · 15+ models                 │
├──────────────────────────────────────────────────────────┤
│                      Redis 7                              │
│              Celery broker / task queue                    │
└──────────────────────────────────────────────────────────┘
```

## Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 14 (App Router), React 18, TypeScript, Tailwind CSS, shadcn/ui |
| Backend API | Next.js API Routes, Prisma ORM |
| Database | PostgreSQL 16, tsvector full-text search, GIN indexes |
| Cache / Queue | Redis 7 (Celery broker) |
| Scraping | Python 3.9+, FastAPI, Celery, BeautifulSoup4, lxml, requests |
| Auth | NextAuth.js (credentials provider, JWT sessions) |
| MERX Auth | Secure session management, CSRF token extraction, document download |
| Document Parsing | PyPDF2 (PDF), python-docx (DOCX) |
| AI Analysis | OpenAI GPT (gpt-4o-mini), structured JSON output |
| Containerization | Docker Compose (PostgreSQL, Redis, FastAPI, Celery) |

## Project Structure

```
Lead-Research/
├── apps/web/                          # Next.js frontend + API
│   ├── prisma/
│   │   ├── schema.prisma              # Full database schema (15 models)
│   │   ├── seed.ts                    # Admin user seed
│   │   └── setup-search.sql           # tsvector + GIN index setup
│   └── src/
│       ├── app/
│       │   ├── api/                   # REST API routes
│       │   │   ├── opportunities/     # Search, detail, workflow, notes
│       │   │   ├── intelligence/[id]/ # AI tender intelligence data
│       │   │   ├── stats/             # Dashboard summary stats
│       │   │   ├── sources/           # Source CRUD + analytics
│       │   │   ├── source-runs/       # Crawl run logs
│       │   │   ├── exports/           # CSV/Excel export
│       │   │   ├── saved-searches/    # Saved search management
│       │   │   └── crawler/           # Manual crawl trigger
│       │   ├── dashboard/             # 7 dashboard pages
│       │   │   ├── page.tsx           # Intelligence overview
│       │   │   ├── opportunities/     # Search/filter + detail view
│       │   │   ├── sources/           # Source network + yield analytics
│       │   │   ├── logs/              # Crawl run history
│       │   │   ├── saved-searches/    # Saved intelligence views
│       │   │   └── settings/          # Admin control center
│       │   └── login/                 # Auth login page
│       ├── components/ui/             # shadcn/ui components
│       ├── lib/                       # Prisma client, auth config, utils
│       └── types/                     # Shared TypeScript interfaces
├── services/scraper/                  # Python scraping + intelligence
│   └── src/
│       ├── api/main.py                # FastAPI endpoints (crawl, intelligence)
│       ├── crawlers/
│       │   ├── base.py                # Base crawler (HTTP, retry, robots.txt)
│       │   ├── merx.py                # MERX listing + detail crawler
│       │   ├── merx_auth.py           # Authenticated MERX session + doc download
│       │   ├── biddingo.py            # Biddingo REST API crawler
│       │   ├── pipeline.py            # Full crawl pipeline orchestrator
│       │   └── procurement_sources.py # Crawler class registry
│       ├── intelligence/
│       │   ├── analyzer.py            # AI tender analysis (OpenAI GPT)
│       │   ├── doc_parser.py          # PDF/DOCX text extraction
│       │   └── merx_pipeline.py       # End-to-end MERX intelligence pipeline
│       ├── tasks/                     # Celery task definitions
│       └── utils/
│           ├── scorer.py              # Relevance Engine v2
│           ├── normalizer.py          # Date, location, status normalization
│           └── dedup.py               # SHA-256 fingerprint deduplication
├── data/sources.yaml                  # Master source registry (300+ sources)
├── documents/merx/                    # Downloaded tender documents (gitignored)
├── docker-compose.yml                 # Full service orchestration
├── .env.example                       # Environment variable template
└── .env                               # Local configuration (gitignored)
```

## Key Features

### 1. Multi-Source Crawling
- **MERX** — Full listing + detail page extraction, pagination, 26+ targeted keyword searches, 4 category code searches
- **Biddingo** — REST API integration (`api.biddingo.com`), JSON-based listing + detail, keyword search
- **Generic Crawler** — Configurable parser for municipal/school board/housing portals
- **300+ registered sources** covering Canada and the US (federal, provincial/state, municipal, education, healthcare, housing)

### 2. Relevance Engine v2
Multi-tier keyword scoring with word-boundary matching:

| Tier | Weight | Examples |
|------|--------|---------|
| Primary | 12 pts | blinds, roller shades, curtains, drapery, window treatment |
| Secondary | 7 pts | fabric, textile, linen, FF&E, privacy curtain |
| Contextual | 5 pts | hospital renovation, hotel renovation, tenant improvement |
| Negative | -15 pts | watermain, asphalt, software, ERP, snow removal |

Plus: title boosting (2x), source fit bonus, category bonus, semantic phrase detection.

Buckets: `highly_relevant` (60+) · `moderately_relevant` (35–59) · `low_relevance` (15–34) · `irrelevant` (<15)

### 3. Authenticated MERX Document Access
- Secure login using environment variables (`MERX_EMAIL`, `MERX_PASSWORD`)
- CSRF token extraction + session cookie management
- AJAX-based document tab fetching via internal solicitation IDs
- Automated PDF/DOCX download to structured local storage
- Credentials never logged, printed, or exposed in UI

### 4. AI Tender Intelligence
Powered by OpenAI GPT (with rule-based fallback):
- **Project overview** and scope of work analysis
- **Technical requirements** — materials, measurements, compliance, specialized needs
- **Qualification requirements** — experience, certifications, insurance, bonding, labor
- **Critical dates** — site visits, pre-bid meetings, project start/completion
- **Risk factors** — tight deadlines, complex installations, union requirements
- **Business feasibility** — 0-100 score + recommendation (pursue/review/skip)
- **China sourcing analysis** — viability, Buy America/Canadian restrictions, lead times
- **Recommended action** — actionable next step for each tender

### 5. Business Workflow
Per-opportunity workflow states: `new` → `hot` → `review` → `shortlisted` → `pursuing` → `passed`/`not_relevant` → `monitor`

Notes, tags, and workflow history on every opportunity.

### 6. Source Yield Analytics
Per-source tracking: total opportunities, relevant count, highly relevant count, crawl success rate, failure rate, average crawl duration, health status.

### 7. Dashboard Intelligence
- Relevant opportunities count with bucket distribution
- Business pipeline (hot/review/shortlisted/pursuing)
- AI tender intelligence summary (analyzed/pursue/review/skip/avg feasibility)
- Source network health (active/total, priority breakdown, health status)
- Top sources by relevant yield

## Quick Start

### Prerequisites

- Node.js 18+, pnpm, Python 3.9+, Docker

### 1. Clone and configure

```bash
cp .env.example .env
# Edit .env with your database password, admin credentials, etc.
```

### 2. Start infrastructure

```bash
docker compose up -d postgres redis
```

### 3. Install dependencies

```bash
pnpm install
cd services/scraper && python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
```

### 4. Set up the database

```bash
cd apps/web
npx prisma db push
docker exec -i lh-postgres psql -U leadharvest -d leadharvest < prisma/setup-search.sql
npx prisma db seed
```

### 5. Sync sources from registry

```bash
cd services/scraper
python3 -m src.utils.sync_sources
```

### 6. Start the dev server

```bash
cd apps/web
npx next dev -p 3000
```

### 7. Open the dashboard

Navigate to [http://localhost:3000/dashboard](http://localhost:3000/dashboard)

Login: `admin@leadharvest.io` / `changeme`

### 8. Run a crawl

```bash
cd services/scraper
python3 run_pipeline.py --source merx
python3 run_pipeline.py --source biddingo
```

### 9. Run AI intelligence analysis

```bash
cd services/scraper
# Single opportunity
python3 run_intelligence.py --id <opportunity-uuid>

# Batch: analyze top unanalyzed MERX opportunities
python3 run_intelligence.py --batch --limit 10 --min-relevance 40
```

## Environment Variables

See `.env.example` for all configuration. Key variables:

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_URL` | Redis connection for Celery broker |
| `NEXTAUTH_SECRET` | JWT signing secret |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | Seed admin user credentials |
| `SCRAPER_API_KEY` | Internal key for scraper API calls |
| `MERX_EMAIL` / `MERX_PASSWORD` | MERX paid account credentials (for document access) |
| `OPENAI_API_KEY` | OpenAI API key (for AI tender analysis) |

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/stats` | Dashboard summary with intelligence stats |
| GET | `/api/opportunities` | Search/filter/paginate with full-text search |
| GET | `/api/opportunities/[id]` | Opportunity detail with docs, notes, tags |
| PATCH | `/api/opportunities/[id]` | Update workflow status |
| POST | `/api/opportunities/[id]/notes` | Add a note |
| GET | `/api/intelligence/[id]` | AI intelligence + documents for an opportunity |
| GET | `/api/sources` | List all data sources with yield analytics |
| POST | `/api/sources` | Create a new source |
| GET/PATCH/DELETE | `/api/sources/[id]` | Manage a single source |
| GET | `/api/source-runs` | Crawl run history (paginated) |
| GET | `/api/exports?format=csv\|xlsx` | Export filtered opportunities |
| GET/POST | `/api/saved-searches` | List/create saved searches |
| DELETE | `/api/saved-searches/[id]` | Delete a saved search |
| POST | `/api/crawler/trigger` | Manually trigger a crawl cycle |

## Database Schema

15 models across opportunities, sources, intelligence, workflow, and admin:

- **Opportunity** — Title, description, dates, location, relevance score/bucket, keywords, industry tags, workflow status, fingerprint dedup
- **TenderIntelligence** — AI analysis results: project overview, scope, technical reqs, qualifications, risk factors, feasibility score, recommendation, China sourcing
- **OpportunityDocument** — Downloaded tender files with text extraction status, page counts, local paths
- **Source** — Registry entry with crawl config, industry fit score, priority, health status, yield analytics
- **SourceRun** — Crawl execution log with timing, counts, errors
- **Organization** — Normalized issuing organizations
- **User** — Admin authentication
- **Note** — Per-opportunity notes
- **Tag** / **OpportunityTag** — Tagging system
- **SavedSearch** — Persisted filter configurations
- **Alert** — Notification system (future)
- **AuditLog** — Admin action tracking

## Ethical Data Collection

- Only accesses publicly available procurement data (or authorized paid accounts like MERX)
- Respects `robots.txt` on every target domain
- Configurable rate limiting (default: 3 seconds between requests)
- Identifies itself via a transparent User-Agent header
- Does not bypass logins, CAPTCHAs, paywalls, or access controls (except authorized MERX)
- Stores only publicly posted bid/tender information
- Credentials stored exclusively in environment variables, never in code or logs

## Data Pipeline

```
Source Registry (sources.yaml)
        │
        ▼
  Listing Page Fetch (with pagination)
        │
        ▼
  Detail Page Fetch (per opportunity)
        │
        ▼
  Field Extraction (title, org, dates, description, contacts)
        │
        ▼
  Normalization (dates, locations, currency, status)
        │
        ▼
  Deduplication (SHA-256 fingerprint + source/external_id)
        │
        ▼
  Relevance Scoring (multi-tier keyword + semantic + source fit)
        │
        ▼
  Industry Tagging (automatic from matched keywords)
        │
        ▼
  Database Storage (PostgreSQL with SAVEPOINT isolation)
        │
        ▼
  ┌─────────────────────────────────┐
  │  AI Intelligence Pipeline       │
  │  (for high-relevance MERX)      │
  │                                 │
  │  1. MERX authenticated login    │
  │  2. Document tab fetch (AJAX)   │
  │  3. PDF/DOCX download           │
  │  4. Text extraction             │
  │  5. GPT analysis                │
  │  6. Feasibility + recommendation│
  │  7. Store in tender_intelligence│
  └─────────────────────────────────┘
        │
        ▼
  Dashboard Display (with intelligence panels)
```

## Current Data

| Metric | Count |
|--------|-------|
| Registered sources | 300+ |
| Active crawlable sources | 5+ (MERX, Biddingo, SaskTenders, Vancouver, SAM.gov) |
| Total opportunities collected | 550+ |
| Relevant opportunities | 128+ |
| Highly relevant | 73+ |
| AI-analyzed tenders | 4 |
| Downloaded tender documents | 3+ |

## License

Private — internal use only.
