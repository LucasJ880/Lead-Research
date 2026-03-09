# BidToGo — Dev Mode (Internal)

This defines the Dev implementation mode used internally by the Executive Product Orchestrator. The user does not invoke this directly — the orchestrator activates it automatically when implementation, debugging, or infrastructure work is needed.

---

## When Dev Mode Is Activated

- User approves an implementation after PM analysis
- User gives a direct technical instruction ("fix X", "add Y")
- User reports a bug (Dev does root cause first)
- A deployment, infrastructure, or DevOps task is needed

---

## Dev Mode Behavior

### Before Writing Code

1. Read the files being modified. Understand current state.
2. If requirements are ambiguous and no PM criteria exist: draft 2-3 acceptance criteria and confirm with user before proceeding.
3. Explain what will change and which files are affected.

### While Writing Code

1. **Incremental changes.** Smallest change that solves the problem.
2. **No unrelated refactors.** Stay focused on the task.
3. **Preserve working code.** Don't rewrite what isn't broken.
4. **Handle edge cases.** API: missing/invalid params, errors. UI: loading/error/empty. Scrapers: failures, changed HTML.
5. **No fake success states.** If it reports success, the data must exist.

### After Writing Code

1. Verify: type checks, linter, smoke tests.
2. Summarize: what changed, files affected, how to test.
3. Hand off to QA mode automatically (the orchestrator handles this).

### For Bug Fixes

1. **Root cause first.** Explain what is broken and why before fixing.
2. Trace the full execution chain.
3. Fix the specific issue.
4. Document what was wrong and what changed.

---

## Code Quality Standards

### TypeScript (apps/web/)
- Strict typing, no `any`
- API routes: try/catch, Zod validation, parameterized SQL
- React: loading/error/empty states in every data-fetching component
- shadcn/ui for components, lucide-react for icons, `cn()` for classes

### Python (services/scraper/)
- Type hints on all functions
- Pydantic models for cross-module data
- Logging via project logger, not `print()` in production
- Selectors as module-level constants in parsers

### Database
- Prisma owns the schema
- UUIDs for PKs, UTC timestamps
- Never drop columns without checking references
- Raw SQL only for tsvector/GIN operations

### Infrastructure
- Docker Compose for all services
- Caddy for HTTPS
- Env vars for all secrets
- No hardcoded credentials

---

## BidToGo Technical Knowledge

### Services

| Service | Container | Port | Stack |
|---------|-----------|------|-------|
| Web app | lh-app | 3000 | Next.js 14 |
| Scraper API | lh-scraper-api | 8001 | FastAPI |
| Scraper worker | lh-scraper-worker | — | Celery |
| Scraper beat | lh-scraper-beat | — | Celery Beat |
| Database | lh-postgres | 5432 | PostgreSQL 16 |
| Cache | lh-redis | 6379 | Redis 7 |
| Proxy | lh-caddy | 80/443 | Caddy |

### Key Routes

| Route | Service | Purpose |
|-------|---------|---------|
| `/api/stats` | Next.js | Dashboard stats |
| `/api/opportunities` | Next.js | Opportunity list |
| `/api/intelligence/analyze` | Next.js → FastAPI | AI analysis trigger |
| `/api/scraper/crawl` | Next.js → FastAPI | Crawler trigger |
| `/api/agent/*` | FastAPI | MERX agent sync |
| `/api/analysis/*` | FastAPI | AI analysis endpoints |

### MERX Agent
- `agent/merx_agent.py` — Playwright browser, SAML SSO
- All auth operations in one browser context
- Syncs via `/api/agent/*` with `AGENT_API_KEY`

---

## Rules

- Never ship code without reading the files being changed.
- Never create fake success states.
- Never bypass the data pipeline.
- Never hardcode credentials.
- Never mix feature work with unrelated refactoring.
- Never deploy without verifying the build.
- Always explain root cause before fixing bugs.
