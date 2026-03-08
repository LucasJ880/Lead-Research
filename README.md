# LeadHarvest — Opportunity Intelligence for Window Coverings

A full-stack web platform that collects, normalizes, scores, and surfaces public procurement opportunities relevant to the blinds/shades/curtains/drapery industry across Canada and the United States.

## What It Does

- **Collects** public bids, tenders, RFPs, procurement notices, and construction opportunities from authorized public sources (MERX, SAM.gov, BidNet Direct, municipal portals)
- **Normalizes** raw data into a consistent schema with location, dates, contacts, documents, and categories
- **Scores** every opportunity for relevance to the window covering business (0–100 scale) using keyword matching, org-type bonuses, and category signals
- **Surfaces** results in a real-time dashboard with full-text search, multi-filter, sort, and pagination
- **Exports** filtered results to CSV or Excel
- **Saves searches** for quick re-use and future alerting

## Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 14 (App Router), React 18, TypeScript, Tailwind CSS, shadcn/ui |
| Backend API | Next.js API Routes, Prisma ORM |
| Database | PostgreSQL 16 with tsvector full-text search + GIN indexes |
| Cache / Queue | Redis 7 (broker for Celery workers) |
| Scraping | Python 3.9+, FastAPI, Celery, BeautifulSoup4, lxml |
| Auth | NextAuth.js (credentials provider, JWT sessions) |
| Containerization | Docker Compose |

## Project Structure

```
Lead-Research/
├── apps/web/                    # Next.js frontend + API
│   ├── prisma/
│   │   ├── schema.prisma        # Full database schema (14 models)
│   │   ├── seed.ts              # Demo seed (25 realistic opportunities)
│   │   └── setup-search.sql     # tsvector + GIN index setup
│   └── src/
│       ├── app/
│       │   ├── api/             # 10 API route files
│       │   │   ├── opportunities/route.ts       # GET: search, filter, paginate
│       │   │   ├── opportunities/[id]/route.ts  # GET: detail view
│       │   │   ├── opportunities/[id]/notes/route.ts  # POST: add notes
│       │   │   ├── stats/route.ts               # GET: dashboard stats
│       │   │   ├── sources/route.ts             # GET/POST: sources CRUD
│       │   │   ├── sources/[id]/route.ts        # GET/PATCH/DELETE: source
│       │   │   ├── source-runs/route.ts         # GET: crawl logs
│       │   │   ├── exports/route.ts             # GET: CSV/Excel export
│       │   │   ├── saved-searches/route.ts      # GET/POST: saved searches
│       │   │   └── saved-searches/[id]/route.ts # DELETE: saved search
│       │   ├── dashboard/       # 6 dashboard pages
│       │   │   ├── page.tsx                     # Overview stats + recent
│       │   │   ├── opportunities/page.tsx       # Search/filter list
│       │   │   ├── opportunities/[id]/page.tsx  # Detail view
│       │   │   ├── sources/page.tsx             # Source management
│       │   │   ├── logs/page.tsx                # Crawl run history
│       │   │   └── saved-searches/page.tsx      # Saved searches
│       │   └── login/page.tsx   # Auth login page
│       ├── components/ui/       # shadcn/ui components
│       ├── lib/                 # Prisma client, auth config, utils
│       └── types/               # Shared TypeScript interfaces
├── services/scraper/            # Python scraping workers
│   └── src/
│       ├── api/main.py          # FastAPI endpoints
│       ├── crawlers/            # Base + generic crawlers
│       ├── parsers/             # HTML parsers
│       ├── tasks/               # Celery task definitions
│       └── utils/               # Dedup, normalizer, scorer
├── docs/                        # PRD, architecture, database docs
├── docker-compose.yml           # PostgreSQL + Redis
└── .env                         # Environment configuration
```

## Quick Start

### Prerequisites

- Node.js 18+, pnpm, Python 3.9+, Docker

### 1. Start infrastructure

```bash
docker compose up -d postgres redis
```

### 2. Install dependencies

```bash
pnpm install
```

### 3. Set up the database

```bash
cd apps/web
ln -sf ../../.env .env              # Symlink env vars for Next.js
npx prisma db push                  # Create tables
docker exec -i lh-postgres psql -U leadharvest -d leadharvest < prisma/setup-search.sql  # Full-text search
npx prisma db seed                  # Load 25 demo opportunities
```

### 4. Start the dev server

```bash
cd apps/web
npx next dev -p 3000
```

### 5. Open the dashboard

Navigate to [http://localhost:3000/dashboard](http://localhost:3000/dashboard)

Login: `admin@leadharvest.io` / `changeme`

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/stats` | Dashboard summary (totals, high-relevance, recent) |
| GET | `/api/opportunities` | Search/filter/paginate with full-text search |
| GET | `/api/opportunities/[id]` | Opportunity detail with docs, notes, tags |
| POST | `/api/opportunities/[id]/notes` | Add a note to an opportunity |
| GET | `/api/sources` | List all data sources |
| POST | `/api/sources` | Create a new source |
| GET/PATCH/DELETE | `/api/sources/[id]` | Manage a single source |
| GET | `/api/source-runs` | Crawl run history (paginated) |
| GET | `/api/exports?format=csv\|xlsx` | Export filtered opportunities |
| GET/POST | `/api/saved-searches` | List/create saved searches |
| DELETE | `/api/saved-searches/[id]` | Delete a saved search |

### Search Parameters

`GET /api/opportunities` accepts:

- `keyword` — Full-text search using PostgreSQL `websearch_to_tsquery`
- `status` — open, closed, awarded, cancelled
- `country` — CA, US
- `region` — ON, BC, AB, QC, CA, TX, FL, NY, etc.
- `sourceId` — Filter by source UUID
- `category` — Window Coverings, FF&E, Interior Finishing, etc.
- `minRelevance` — Minimum relevance score (0-100)
- `postedAfter`, `postedBefore` — Date range for posted date
- `closingAfter`, `closingBefore` — Date range for closing date
- `sort` — `newest` (default), `closing_soon`, `relevance`
- `page`, `pageSize` — Pagination (default: page 1, 20/page, max 100)

## Demo Data

The seed includes 25 realistic procurement opportunities:

- **High relevance (85-98)**: Direct window covering bids — roller shades, motorized blinds, privacy curtains, vertical blinds, blackout systems
- **Medium relevance (55-80)**: FF&E procurement, interior finishing, renovation projects that include window treatments
- **Low relevance (15-45)**: General construction/renovation where window coverings are a small component

Sources: MERX (Canadian), SAM.gov (US federal), BidNet Direct (US state/local)

## Environment Variables

See `.env.example` for all configuration. Key variables:

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_URL` | Redis connection for Celery broker |
| `NEXTAUTH_SECRET` | JWT signing secret |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | Seed user credentials |
| `SCRAPER_API_KEY` | Internal key for scraper API |

## Ethical Data Collection

- Only accesses publicly available procurement data
- Respects `robots.txt` on every target domain
- Configurable rate limiting (default: 3 seconds between requests)
- Identifies itself via a transparent User-Agent header
- Does not bypass logins, CAPTCHAs, paywalls, or access controls
- Stores only publicly posted bid/tender information
