# Product Requirements Document — LeadHarvest

## 1. Product Vision

**LeadHarvest** is a web-based opportunity intelligence platform for window covering businesses. It continuously collects, normalizes, and ranks publicly available procurement opportunities (bids, tenders, RFPs, construction projects) across Canada and the United States, surfacing the ones most relevant to blinds, shades, curtains, drapery, and related interior products.

The platform replaces manual monitoring of dozens of government and institutional procurement portals with a single searchable dashboard, scored for business relevance and updated daily.

### Target User
- Owner/operator of a window covering / blinds / shades business
- Sales and business development teams in the window covering industry
- Estimators who need early visibility into upcoming projects

### Success Metrics (MVP)
- 50+ configured public sources across US and Canada
- 500+ opportunities ingested per week
- <5 min daily workflow: open dashboard → review scored leads → click through to source
- Zero compliance incidents (no restricted data collection)

---

## 2. Core User Stories

| ID | As a... | I want to... | So that... |
|----|---------|-------------|-----------|
| US-01 | Business owner | See a ranked list of new procurement opportunities relevant to window coverings | I can focus on the highest-value leads first |
| US-02 | Business owner | Search opportunities by keyword, region, status, and closing date | I can find specific bids quickly |
| US-03 | Business owner | View full details of an opportunity including description, dates, contacts, and documents | I can evaluate whether to bid |
| US-04 | Business owner | See why the system scored an opportunity as relevant to my business | I trust the scoring and don't miss opportunities |
| US-05 | Business owner | Save searches and get notified when new matches appear | I don't have to check the dashboard constantly |
| US-06 | Business owner | Export filtered results to CSV or Excel | I can share leads with my team or import into CRM |
| US-07 | Business owner | Add private notes to any opportunity | I can track my evaluation and follow-up status |
| US-08 | Business owner | See which sources are active, when they last ran, and if there were errors | I can trust the data is fresh and complete |
| US-09 | Business owner | Add new public data sources without writing code (via config UI) | I can expand coverage as I discover new portals |
| US-10 | Business owner | Filter by country (Canada/US), province/state, and city | I can focus on my serviceable regions |

---

## 3. MVP Feature List

### A. Data Collection Engine
- Configurable source registry with metadata (name, type, URL, region, frequency, selectors)
- Scheduled crawling with polite rate limiting and robots.txt respect
- Support for static HTML and paginated listing pages
- Per-source parser adapters (pluggable architecture)
- Retry logic, error handling, crawl logging
- Raw data snapshot storage for debugging

### B. Data Extraction & Normalization
- Extract: title, description, dates, status, location, contacts, solicitation number, documents, estimated value
- Normalize: dates to ISO 8601, locations to country/region/city, status to enum
- Deduplicate by source+external_id and content fingerprint
- Tag by category (construction, renovation, furnishing, etc.)

### C. Business Relevance Scoring
- Keyword-based scoring (primary: window covering terms → high; secondary: renovation/fit-out → medium)
- Rule-based scoring by organization type and project category
- Composite 0–100 score with explainable breakdown stored per opportunity

### D. Search & Filter Dashboard
- Full-text keyword search across title + description
- Filters: status, country, province/state, city, organization, date range, closing date, category, source, relevance tier
- Sort by: newest, closing soonest, highest relevance
- Paginated results with configurable page size
- Saved search persistence

### E. Opportunity Detail Page
- Full metadata display (title, org, region, dates, status, source URL)
- Description with matched keywords highlighted
- Relevance score with explanation breakdown
- Document links
- User notes (create/edit/delete)
- Direct link to original source page

### F. Source Management
- CRUD for data sources via admin UI
- Active/inactive toggle
- Crawl frequency configuration
- Last run status and stats
- Manual crawl trigger

### G. Alerting (Backend Structure)
- Saved searches stored with notification preferences
- Backend job to evaluate new opportunities against saved searches
- Alert records created when matches found
- Closing-soon alerts (configurable days threshold)
- Email digest structure (backend-ready; actual email sending is post-MVP)

### H. Export
- Export current filtered view to CSV
- Export current filtered view to Excel (.xlsx)

### I. Admin & Operations
- Simple credential-based admin auth (single-tenant MVP)
- Crawl log viewer with status, duration, counts, errors
- Audit log for administrative actions

---

## 4. Future Roadmap (Post-MVP)

| Phase | Features |
|-------|---------|
| v1.1 | Email digest delivery (SendGrid/SES integration) |
| v1.2 | Playwright-based scrapers for JavaScript-rendered pages |
| v1.3 | AI-powered description summarization and relevance scoring (LLM) |
| v1.4 | Multi-user support with role-based access |
| v1.5 | CRM integration (export to HubSpot, Salesforce) |
| v1.6 | Bid calendar view with closing date timeline |
| v1.7 | Mobile-responsive PWA |
| v1.8 | Public API for third-party integrations |
| v2.0 | ML-based opportunity classification trained on user feedback |
| v2.1 | Competitive intelligence — track which competitors are bidding |
| v2.2 | Document parsing (extract specs from attached PDFs) |

---

## 5. Compliance & Legal Constraints

1. **Public data only** — Only collect from publicly accessible pages without authentication
2. **robots.txt** — Respect all robots.txt directives
3. **Rate limiting** — Minimum 2-second delay between requests to same domain; configurable per source
4. **No bypass** — Never circumvent CAPTCHAs, login walls, paywalls, or anti-bot systems
5. **Attribution** — Store and display source URLs; always link back to original
6. **Data retention** — Raw HTML snapshots retained for 90 days for debugging, then purged
7. **Terms compliance** — Review terms of use before adding any new source; flag sources requiring review
8. **User-agent** — Use a descriptive, honest user-agent string identifying the crawler

---

## 6. Business Relevance Keyword Dictionary

### Primary Keywords (High Relevance — score boost +40)
window coverings, blinds, roller shades, zebra blinds, curtains, drapery, drapes, blackout shades, solar shades, motorized shades, skylight shades, custom shades, exterior shades, commercial blinds, privacy curtains, drapery tracks, window treatments, venetian blinds, vertical blinds, honeycomb shades, cellular shades, roman shades, sheer shades, panel track blinds, plantation shutters, window film, shade systems, motorized window, automated shades

### Secondary Keywords (Medium Relevance — score boost +20)
interior fit-out, tenant improvement, renovation, furnishing, FF&E, furniture fixtures equipment, design-build, school modernization, hospital expansion, condo development, apartment development, hospitality renovation, office fit-out, interior finishing, millwork, soft furnishing, window replacement, building envelope, interior design services, commercial interiors

### Project Type Indicators (Medium Relevance — score boost +15)
school renovation, hospital renovation, senior living, public housing, hotel construction, office construction, university residence, dormitory, healthcare facility, government building, courthouse, library, community center, recreation center, fire station, police station, correctional facility

### Negative Keywords (Reduce score or exclude)
software, IT services, vehicles, road construction, bridge, sewer, water main, HVAC only, electrical only, plumbing only, demolition only, landscaping only, paving
