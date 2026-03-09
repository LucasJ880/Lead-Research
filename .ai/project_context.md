# BidToGo — Project Context

This file is the long-term memory for any AI agent working on this project.
Read it before writing any code, making architectural decisions, or modifying the database schema.

---

## Project Identity

| Field | Value |
|-------|-------|
| **Name** | BidToGo |
| **Domain** | bidtogo.ca |
| **Type** | Procurement intelligence platform |
| **Stage** | Production (internal testing) |
| **Deployment** | DigitalOcean Droplet, 8GB RAM, Docker Compose, Caddy HTTPS |

---

## Product Vision

BidToGo is a BidPrime-style opportunity intelligence platform built for the North American window covering and textile furnishing industry. It replaces manual monitoring of dozens of government and institutional procurement portals by automatically collecting, normalizing, scoring, and surfacing publicly available bids, tenders, RFPs, and procurement notices in a single searchable dashboard.

The system is designed so that sales, estimating, and business development teams can discover relevant opportunities in minutes instead of hours, focus effort on the highest-value leads, and never miss a deadline.

BidToGo is not a generic bid scraper. It is an intelligence product that prioritizes the owner's business vertical while maintaining an architecture capable of expanding to broader verticals later.

---

## Business Focus

The platform prioritizes opportunities related to:

**Primary products**: blinds, roller shades, zebra blinds, window coverings, curtains, drapery, shades, motorized shades, blackout shades, solar shades, skylight shades, window treatment, plantation shutters

**Textile and supply**: fabric, textile, linen, bedding, blankets, privacy curtains, cubicle curtains, healthcare curtains, hospitality linen, soft furnishings

**Project context**: FF&E, furnishing, interior fit-out, tenant improvement, hospital renovation, school furnishing, hotel renovation, condo furnishing

**Negative signals**: watermain, sewer, asphalt, bridge, software, ERP, telecom, legal services, fuel supply, snow removal, heavy equipment

---

## Current Production Status

### What is working

| Component | Status | Notes |
|-----------|--------|-------|
| Dashboard UI | Live | Next.js 14 at bidtogo.ca |
| Admin authentication | Live | NextAuth.js, bcrypt |
| SAM.gov crawler | Live | Primary working source, real opportunities ingested |
| Relevance scoring engine | Live | Multi-tier keywords, 4-bucket system, semantic matching |
| Opportunity search/filter | Live | Full-text search, multi-dimensional filters |
| Source registry | Live | 300+ registered sources, SAM.gov actively crawling |
| Crawl logs and diagnostics | Live | Real run records, source-level metrics |
| On-demand AI analysis | Live | OpenAI GPT-4o-mini, Quick Analysis mode |
| Settings / control center | Live | Business focus, keyword config, source controls |

### What is in progress

| Component | Status | Notes |
|-----------|--------|-------|
| MERX authenticated connector | Architecture complete | Local Playwright agent built, blocked by IDP session lock |
| Deep Analysis mode | Planned | Requires document download pipeline |
| Additional source crawlers | Planned | BuyAndSell.gc.ca, BC Bid, municipal portals |
| Email alerts | Planned | Saved search + digest notifications |

### Known limitations

- MERX requires local authenticated browser access (datacenter IP blocked)
- Only SAM.gov is actively producing real opportunities in production
- AI analysis is on-demand only (no auto-analysis to control token costs)
- Single admin user (no multi-user roles yet)

---

## Technical Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 14 (App Router), React 18, TypeScript, Tailwind CSS, shadcn/ui |
| API | Next.js API Routes, Prisma ORM |
| Database | PostgreSQL 16, tsvector full-text search, GIN indexes, JSONB |
| Cache/Queue | Redis 7 (Celery broker) |
| Scraper engine | Python 3.9+, FastAPI, Celery, BeautifulSoup, lxml |
| AI analysis | OpenAI GPT-4o-mini via TenderAnalyzer |
| MERX agent | Playwright-based local authenticated browser crawler |
| Deployment | Docker Compose, Caddy (HTTPS), DigitalOcean |
| Auth | NextAuth.js, bcrypt password hashing |

### Monorepo Structure

```
Lead-Research/
├── apps/web/              → Next.js frontend + API (TypeScript)
│   ├── src/app/api/       → API route handlers
│   ├── src/app/dashboard/ → Dashboard pages
│   ├── prisma/            → Schema, migrations
│   └── src/components/    → UI components
├── services/scraper/      → Python scraping + AI analysis (FastAPI + Celery)
│   ├── src/api/           → FastAPI endpoints (health, crawl, analysis, agent sync)
│   ├── src/crawlers/      → Source crawlers
│   ├── src/parsers/       → HTML parsers
│   ├── src/intelligence/  → TenderAnalyzer, AI pipeline
│   └── src/utils/         → Scorer, normalizer, dedup
├── agent/                 → Local MERX Playwright agent
├── .ai/                   → AI team rules and project context
├── docker-compose.prod.yml → Production services
└── Caddyfile              → HTTPS reverse proxy config
```

---

## Architecture Layers

| Layer | Purpose |
|-------|---------|
| Source Layer | Source registry, access modes, crawl config |
| Access Layer | HTTP, browser, authenticated browser, API fetch |
| Extraction Layer | Listing pages, detail pages, pagination, normalization |
| Intelligence Layer | Relevance scoring, AI analysis, feasibility assessment |
| Product Layer | Dashboard, opportunities, sources, logs, settings, export |

---

## Data Pipeline

All opportunity data flows through this pipeline:

```
source → access/fetch → extraction/parse → normalize → score → deduplicate → database → API → dashboard
```

No module may bypass this pipeline. Scrapers must not write directly to the database without normalization and scoring. The API layer must not modify opportunity data directly. The frontend must not query sources directly.

---

## Current Roadmap Priorities

| Priority | Item |
|----------|------|
| P0 | Keep SAM.gov pipeline healthy and observable |
| P0 | Production stability — all services start reliably |
| P1 | Complete MERX local connector (unblock IDP session, verify crawl) |
| P1 | On-demand AI Quick Analysis stable in production |
| P2 | Expand to 3-5 more active source crawlers |
| P2 | Source yield analytics and health monitoring |
| P3 | Email alert digests for saved searches |
| P3 | Multi-user access with role-based permissions |
| P3 | Deep Analysis mode with document intelligence |

---

## Compliance Constraints

These rules are non-negotiable:

1. **Public data only** — Only collect from publicly accessible pages (exception: MERX via authorized account on local machine)
2. **robots.txt** — Respect all robots.txt directives
3. **Rate limiting** — Minimum 2-second delay between requests to the same domain
4. **No bypass** — Never circumvent CAPTCHAs, paywalls, or anti-bot systems
5. **Attribution** — Always store and display the source URL
6. **No fabrication** — Never generate fake opportunity data
7. **Credentials safety** — Never log or hardcode credentials, API keys, or secrets
