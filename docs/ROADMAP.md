# LeadHarvest — Improvement Roadmap

## Phase 1: More Data Sources (Priority: High)

### 1.1 Live API Integrations
- **SAM.gov Public API** — Replace demo adapter with real API calls using `api.sam.gov/opportunities/v2/search`. Requires free API key registration.
- **MERX / buyandsell.gc.ca** — Canadian federal procurement. Some data available via RSS feeds.
- **BidNet Direct** — US municipal aggregator with API access for subscribers.
- **Biddingo** — Canadian bid aggregator popular with Ontario municipalities.

### 1.2 HTML Scraping Sources (via GenericCrawler)
These use the existing CSS-selector-driven `GenericCrawler`:
- Toronto (toronto.ca/business-economy/doing-business-with-the-city)
- Vancouver (vancouver.ca/doing-business/bid-opportunities.aspx)
- Calgary (calgary.ca/business/selling-to-the-city/current-opportunities.html)
- TDSB, PDSB, YRDSB school board procurement pages
- TCHC, BC Housing, NYCHA bid portals
- Construction-specific: BuildForce Canada, Daily Commercial News

### 1.3 RSS / Atom Feed Sources
Many government portals publish RSS feeds for new tenders. Build an `RSSCrawler` subclass of `BaseCrawler` that parses feeds natively — lighter weight than full HTML scraping.

---

## Phase 2: AI Classification & Enrichment (Priority: High)

### 2.1 LLM-Powered Relevance Scoring
Replace keyword-matching scorer with a two-stage approach:
1. **Fast keyword pre-filter** (current scorer) — eliminate obvious non-matches
2. **LLM classification** for anything scoring > 20 — use GPT-4o-mini or Claude Haiku to assess:
   - Is this opportunity genuinely relevant to window covering / blinds / shades installation?
   - What specific products are needed? (roller shades, drapery, blinds, etc.)
   - What's the project scale? (number of units, square footage)
   - Confidence score 0-100

Cost estimate: ~$0.01 per opportunity at Haiku pricing, ~$2/day for 200 daily opportunities.

### 2.2 Automatic Opportunity Summary
Generate a 2-3 sentence business summary for each opportunity:
- What products are needed
- Approximate quantities
- Key deadlines
- Bid requirements (bonds, certifications, site visits)

### 2.3 Smart Categorization
Auto-tag opportunities with product categories:
- Roller Shades / Solar Shades / Blackout Shades
- Vertical Blinds / Venetian Blinds
- Drapery / Privacy Curtains
- Motorized Systems
- FF&E (general furnishing packages that include window coverings)

---

## Phase 3: Email Alerts & Notifications (Priority: High)

### 3.1 Saved Search Alerts
- Extend the existing `saved_searches` table with notification preferences
- Send daily/weekly digest emails when new opportunities match a saved search
- Use Resend or SendGrid for transactional email
- Include: opportunity title, score, closing date, direct link

### 3.2 Alert Rules Engine
- High-relevance alert: Immediately notify when score > 80
- Closing soon alert: 7 days before deadline for tracked opportunities
- New source alert: First time an opportunity appears from a new organization
- Weekly summary: Top 10 opportunities of the week

### 3.3 Implementation Stack
- Celery Beat for scheduled checks (already scaffolded)
- Email templates with MJML or React Email
- Preference management UI in the dashboard

---

## Phase 4: Auth Hardening & Multi-User (Priority: Medium)

### 4.1 Session Management
- Replace credential-based auth with proper JWT + refresh tokens
- Session expiry and rotation
- Rate limiting on login attempts

### 4.2 Role-Based Access Control
- **Admin**: Full access, manage sources, configure scrapers
- **Analyst**: View opportunities, add notes, create saved searches
- **Viewer**: Read-only access to opportunities and reports

### 4.3 Audit Logging
- Track all user actions (views, exports, note additions)
- Source of truth for compliance if bidding on government contracts

---

## Phase 5: Scoring Improvements (Priority: Medium)

### 5.1 Machine Learning Scorer
- Train a classifier on user feedback (starred / dismissed opportunities)
- Features: keywords, organization type, project value, location, category
- Gradually replace rule-based scorer as training data grows

### 5.2 Organization Intelligence
- Build profiles for repeat issuers (e.g., "City of Toronto issues 3-4 window covering tenders per year")
- Track win/loss history per organization
- Identify organizations with upcoming budget cycles

### 5.3 Competitive Intelligence
- Detect when competitors are mentioned in bid documents
- Track which opportunities were awarded and to whom
- Build a competitor database from public award notices

---

## Phase 6: Production Deployment (Priority: Medium)

### 6.1 Infrastructure
- **Option A**: Railway.app — Simplest deployment, PostgreSQL and Redis included
- **Option B**: Fly.io — More control, global edge deployment
- **Option C**: AWS ECS — Production-grade, auto-scaling, most complex

### 6.2 CI/CD Pipeline
- GitHub Actions for automated testing
- Preview deployments on PRs
- Automated database migrations
- Health checks and uptime monitoring

### 6.3 Monitoring & Observability
- Sentry for error tracking
- Prometheus/Grafana for crawl metrics (pages/min, success rate, latency)
- PagerDuty integration for crawl failures
- Weekly reports: opportunities collected, sources healthy, top matches

---

## Phase 7: Advanced Features (Priority: Low)

### 7.1 Document Analysis
- Download and parse bid documents (PDFs) attached to opportunities
- Extract: product specifications, quantities, deadlines, site visit dates
- Store parsed data in the `documents` table

### 7.2 Bid Management
- Track which opportunities the user is actively bidding on
- Pipeline stages: Reviewing → Preparing Bid → Submitted → Won/Lost
- Deadline calendar integration (Google Calendar / Outlook)

### 7.3 Market Intelligence Dashboard
- Geographic heat map of opportunities
- Trend analysis: which regions have growing demand
- Seasonal patterns (school renovations peak in spring/summer)
- Average contract values by organization type

### 7.4 API for Partners
- REST API for CRM integration (Salesforce, HubSpot)
- Webhook notifications for new high-relevance opportunities
- Export integrations (QuickBooks, Excel templates)
