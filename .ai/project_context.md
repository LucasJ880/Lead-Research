# LeadHarvest — Project Context

This file is the long-term memory for any AI assistant or engineer working on this project.
Read it before writing any code, making architectural decisions, or modifying the database schema.

---

## Project Mission

LeadHarvest is a web-based opportunity intelligence platform built for a window covering business operating in North America. It replaces the manual process of monitoring dozens of government and institutional procurement portals by automatically collecting, normalizing, scoring, and surfacing publicly available bids, tenders, RFPs, procurement notices, and construction opportunities — all in a single searchable dashboard.

The system exists so that sales, estimating, and business development teams can discover relevant opportunities in minutes instead of hours, focus effort on the highest-value leads, and never miss a deadline.

---

## Target Market

| Dimension | Details |
|-----------|---------|
| **Industry** | Window coverings — blinds, shades, curtains, drapery, and related interior products |
| **Company size** | Small-to-medium window covering businesses with 1–50 employees |
| **Users** | Owner-operators, sales/BD teams, estimators |
| **Geography** | Canada and the United States |
| **Opportunity types** | Public bids, tenders, RFPs, procurement notices, construction projects, renovations, facility upgrades, interior fit-outs |

### Target Regions

**Canada**: All provinces and territories, with emphasis on Ontario, British Columbia, Alberta, and Quebec.

**United States**: All 50 states, with emphasis on California, Texas, Florida, New York, and Illinois.

---

## Industry Keywords

These keyword lists drive the relevance scoring engine and full-text search behavior. They are the business core of the platform. Any modification to these lists changes which opportunities get surfaced to the user.

### Primary Keywords (direct relevance — score boost +40)

window coverings, blinds, roller shades, zebra blinds, curtains, drapery, drapes, blackout shades, solar shades, motorized shades, skylight shades, custom shades, exterior shades, commercial blinds, privacy curtains, drapery tracks, window treatments, venetian blinds, vertical blinds, honeycomb shades, cellular shades, roman shades, sheer shades, panel track blinds, plantation shutters, window film, shade systems, motorized window, automated shades

### Secondary Keywords (adjacent relevance — score boost +20)

interior fit-out, tenant improvement, renovation, furnishing, FF&E, furniture fixtures equipment, design-build, school modernization, hospital expansion, condo development, apartment development, hospitality renovation, office fit-out, interior finishing, millwork, soft furnishing, window replacement, building envelope, interior design services, commercial interiors

### Project Type Indicators (contextual relevance — score boost +15)

school renovation, hospital renovation, senior living, public housing, hotel construction, office construction, university residence, dormitory, healthcare facility, government building, courthouse, library, community center, recreation center, fire station, police station, correctional facility

### Negative Keywords (reduce score or exclude)

software, IT services, vehicles, road construction, bridge, sewer, water main, HVAC only, electrical only, plumbing only, demolition only, landscaping only, paving

---

## System Components

The platform is composed of six major subsystems. Each has a defined responsibility boundary.

| Component | Technology | Responsibility |
|-----------|-----------|----------------|
| **Dashboard UI** | Next.js 14, React 18, Tailwind CSS, shadcn/ui | Search, filter, view, annotate, and export opportunities |
| **API Layer** | Next.js API Routes, Prisma ORM | RESTful endpoints for all dashboard operations |
| **Database** | PostgreSQL 16 | Persistent storage with full-text search (tsvector), GIN indexes, JSONB |
| **Cache / Queue** | Redis 7 | Celery task broker, application caching, rate-limit state |
| **Scraper Engine** | Python 3.9+, FastAPI, Celery | Fetch, parse, normalize, score, and store opportunity data |
| **Scoring Engine** | Python (integrated with scraper) | Keyword-based 0–100 relevance scoring with explainable breakdowns |

### Monorepo Structure

```
Lead-Research/
├── apps/web/           → Next.js frontend + API (TypeScript)
├── services/scraper/   → Python scraping workers (FastAPI + Celery)
├── docs/               → PRD, architecture, database docs
├── data/               → Source registry (YAML), keyword lists
├── .ai/                → AI assistant rules and project context
└── docker-compose.yml  → Infrastructure (PostgreSQL, Redis)
```

---

## Core Capabilities

1. **Data Collection** — Scheduled and manual crawling of public procurement portals with rate limiting, robots.txt compliance, and error handling.
2. **Data Normalization** — Raw HTML is parsed into structured records with consistent date formats, location hierarchies, status enums, and deduplication fingerprints.
3. **Relevance Scoring** — Every opportunity is scored 0–100 based on keyword matches, organization type, and project category, with a stored breakdown explaining the score.
4. **Full-Text Search** — PostgreSQL `tsvector` with weighted fields (title > summary > description) and `websearch_to_tsquery` for natural-language search.
5. **Filtering & Export** — Multi-dimensional filtering (status, country, region, date ranges, relevance threshold, source, category) with CSV and Excel export.
6. **Saved Searches** — Persistent filter configurations for quick re-use, with a backend structure ready for email alerting.
7. **Notes & Annotations** — Users can attach private notes to any opportunity for tracking evaluation and follow-up status.

---

## Business Goals

| Priority | Goal |
|----------|------|
| P0 | Surface high-relevance window covering opportunities that the business would otherwise miss |
| P0 | Reduce daily opportunity research from hours to under 5 minutes |
| P1 | Cover 50+ public sources across Canada and the US |
| P1 | Ingest 500+ opportunities per week with automated scoring |
| P2 | Enable saved searches with email alerts for new matches |
| P2 | Provide CSV/Excel export for team sharing and CRM import |
| P3 | Support multi-user access with role-based permissions |

---

## Long-Term Vision

**Phase 1 (Current)** — MVP: Collect, score, and display opportunities in a searchable dashboard with export and notes.

**Phase 2** — Alerting: Email digests when new opportunities match saved searches. Closing-soon notifications.

**Phase 3** — Intelligence: AI-powered description summarization. ML-based scoring trained on user feedback (which opportunities the user actually bid on).

**Phase 4** — Scale: 200+ sources. Multi-user with roles. CRM integrations (HubSpot, Salesforce). Public API. Bid calendar view.

**Phase 5** — Competitive: Track which competitors are bidding. Document parsing to extract specs from attached PDFs. Predictive win-rate analysis.

---

## Compliance Constraints

These rules are non-negotiable. Every feature, scraper, and data pipeline must comply.

1. **Public data only** — Only collect from publicly accessible pages that do not require authentication.
2. **robots.txt** — Respect all robots.txt directives on every target domain.
3. **Rate limiting** — Minimum 2-second delay between requests to the same domain. Configurable per source.
4. **No bypass** — Never circumvent CAPTCHAs, login walls, paywalls, or anti-bot systems.
5. **Attribution** — Always store and display the source URL. Always link back to the original listing.
6. **User-Agent** — Use a transparent, honest User-Agent string that identifies the crawler.
7. **Terms compliance** — Review terms of use before adding any new source. Flag sources requiring legal review.
