# LeadHarvest — Coding Rules

These rules ensure consistent, maintainable code generation across all parts of the system.

---

## 1. General Principles

### 1.1 Incremental Over Monolithic

- Prefer small, targeted changes over large rewrites.
- When adding a feature, modify only the files that need to change. Do not refactor unrelated code in the same change.
- If a refactor is needed, do it in a separate step before or after the feature change — never mixed together.

### 1.2 Explain Before Implementing

- Before generating code for a new feature or significant change, explain: (a) what will change, (b) which files are affected, (c) why this approach was chosen.
- If there are multiple valid approaches, present the trade-offs and recommend one with reasoning.

### 1.3 Modular by Default

- Every function should do one thing. If a function has "and" in its description, it should probably be two functions.
- Every file should have a single responsibility. If a file contains both data access and presentation logic, split it.
- Shared logic belongs in utility modules (`lib/` for TypeScript, `utils/` for Python), not duplicated across files.

### 1.4 No Dead Code

- Do not leave commented-out code in production files.
- Do not create placeholder functions that will be "implemented later." Either implement them or don't create them.
- Remove unused imports, variables, and dependencies.

---

## 2. TypeScript / Next.js Rules (apps/web/)

### 2.1 General TypeScript

- Use strict TypeScript. All function parameters and return types should be typed.
- Use interfaces (not `type` aliases) for object shapes that represent API contracts or database models. Use `type` for unions and intersections.
- Import types with `import type { ... }` when the import is only used for type checking.
- Never use `any` in production code. Use `unknown` and narrow with type guards when the type is genuinely uncertain.
- Use `as const` for literal arrays and objects that should not be widened.

### 2.2 Next.js API Routes

- Every API route file lives in `src/app/api/` following Next.js App Router conventions.
- Use `NextRequest` and `NextResponse` from `next/server`.
- All handlers must have a top-level `try/catch` that returns a `500` JSON response on unexpected errors. Never let unhandled exceptions leak to the client.
- Validate request bodies with Zod schemas. Return `400` with `error` and `details` fields on validation failure.
- Use parameterized queries for all SQL. Never interpolate user input into query strings.
- Convert Prisma `Decimal` fields to `number` using `Number(value)` in API responses.
- Convert `Date` fields to ISO 8601 strings using `.toISOString()` in API responses.
- Return consistent response shapes:
  - Success: `{ data, total, page, pageSize, totalPages }` for lists, or the object directly for single resources.
  - Error: `{ error: string, details?: object }` with appropriate HTTP status code.

### 2.3 React Components

- All page components that use hooks or browser APIs must have `"use client"` at the top.
- Use `useEffect` + `useState` for data fetching in client components. Use the pattern:
  ```
  loading state → fetch → set data → clear loading
  ```
- Handle three states in every data-fetching component: loading, error, and empty.
- Use the `cn()` utility from `@/lib/utils` for conditional Tailwind classes.
- Import UI primitives from `@/components/ui/` — never write raw HTML for buttons, cards, badges, or inputs when a component exists.
- Use `lucide-react` for icons. Do not mix icon libraries.

### 2.4 Prisma Usage

- The Prisma client singleton is at `@/lib/prisma`. Always import from there — never create a new `PrismaClient()`.
- Use `prisma.model.findMany()` with explicit `select` or `include` — avoid fetching entire relation trees unnecessarily.
- For full-text search, use `prisma.$queryRawUnsafe()` with parameterized SQL. The `search_vector` column is not in the Prisma schema, so it cannot be queried via the Prisma query builder.
- Never run raw SQL without parameterized placeholders (`$1`, `$2`, ...). This prevents SQL injection.

---

## 3. Python Rules (services/scraper/)

### 3.1 General Python

- Target Python 3.9+ compatibility. Use `from __future__ import annotations` in every file that uses `Type | None` syntax.
- Use Pydantic v2 models for all data structures that cross module boundaries (crawler output, parser output, API request/response).
- Use type hints on all function signatures.
- Use `pathlib.Path` instead of string manipulation for file paths.
- Use `logging` via the project logger (`src/core/logging.get_logger(__name__)`) — never use `print()` for operational output.

### 3.2 Scraper Code

- Each crawler class extends `BaseCrawler` from `src/crawlers/base.py`.
- Each parser class extends `BaseParser` from `src/parsers/base.py`.
- Crawlers handle: fetching pages, pagination, rate limiting, robots.txt checking, HTTP error handling.
- Parsers handle: extracting structured data from HTML. They receive a `BeautifulSoup` object or raw HTML string and return a list of Pydantic models.
- Never hardcode CSS selectors or XPath expressions in crawler business logic. Put them in the source's `crawl_config` JSON or as constants at the top of the parser file.

### 3.3 Celery Tasks

- Task definitions live in `src/tasks/crawl_tasks.py`.
- Tasks must be idempotent — running the same task twice should not create duplicate data (deduplication handles this).
- Tasks must update the `source_runs` table with status, timing, and counts.
- Tasks must catch all exceptions and record them in `source_runs.error_message` before re-raising.

### 3.4 Configuration

- Environment variables are loaded via `src/core/config.py`.
- Never hardcode connection strings, API keys, or secrets in source files.
- Source-specific configuration goes in `data/sources.yaml` or in the `crawl_config` JSONB column in the `sources` database table.

---

## 4. Utility and Shared Code Rules

### 4.1 Do Not Duplicate

Before writing a helper function, check if it already exists:

| Need | TypeScript Location | Python Location |
|------|-------------------|-----------------|
| Date formatting | `apps/web/src/lib/utils.ts` → `formatDate()` | `services/scraper/src/utils/normalizer.py` |
| Currency formatting | `apps/web/src/lib/utils.ts` → `formatCurrency()` | — |
| Relevance color | `apps/web/src/lib/utils.ts` → `getRelevanceColor()` | — |
| CSS class merging | `apps/web/src/lib/utils.ts` → `cn()` | — |
| Relevance scoring | — | `services/scraper/src/utils/scorer.py` → `score_opportunity()` |
| Deduplication | — | `services/scraper/src/utils/dedup.py` |
| Text normalization | — | `services/scraper/src/utils/normalizer.py` |

### 4.2 Shared Types

- TypeScript interfaces in `apps/web/src/types/index.ts` define the API contract shapes. These must match what the API routes actually return.
- Pydantic models in `services/scraper/src/models/opportunity.py` define the scraper pipeline data shapes.
- If you change an API response shape, update the corresponding TypeScript interface. If you change the scraper output shape, update the Pydantic model.

---

## 5. Testing Rules

### 5.1 What to Test

| Component | Test Type | Priority |
|-----------|-----------|----------|
| Relevance scorer | Unit tests with known inputs and expected scores | High |
| Normalizer | Unit tests for date parsing, location extraction | High |
| Deduplicator | Unit tests for fingerprint generation | High |
| Parsers | Unit tests with saved HTML fixtures | High |
| API routes | Integration tests with seeded database | Medium |
| Frontend components | Manual testing via browser (post-MVP: Playwright E2E) | Medium |

### 5.2 Test Fixtures

- Save sample HTML pages for each source in `services/scraper/tests/fixtures/`.
- Never make real HTTP requests in unit tests. Use saved fixtures or mocks.
- Seed the test database with a minimal, predictable dataset. Do not rely on production data.

---

## 6. Error Handling Rules

### 6.1 API Routes

- Wrap every handler in `try/catch`.
- Return structured error responses: `{ error: "Description", details: { ... } }`.
- Use appropriate HTTP status codes: 400 (validation), 404 (not found), 500 (unexpected).
- Log errors server-side with enough context to debug (request params, stack trace).

### 6.2 Scrapers

- Crawlers must handle: connection timeouts, HTTP 4xx/5xx, empty responses, malformed HTML.
- On transient errors (timeout, 503), retry up to 3 times with exponential backoff.
- On permanent errors (404, 403), log and skip — do not retry.
- Always update `source_runs` with the error state so the dashboard shows crawl failures.

### 6.3 Frontend

- Every data-fetching component must handle: loading, error, and empty states.
- Never show a blank page. Show a loading indicator, an error message, or an empty-state message.
- Catch `fetch()` failures and display a user-friendly error — not a raw stack trace.
