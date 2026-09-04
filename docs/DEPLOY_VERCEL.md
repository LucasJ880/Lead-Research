# BidToGo — Deployment on Vercel + Neon

Everything now runs on Vercel and Neon. The DigitalOcean droplet, Docker Compose,
Caddy, Redis and Celery are no longer required.

| Tier | Code | Vercel project | Notes |
|------|------|----------------|-------|
| Web | `apps/web` (Next.js 14, Prisma, next-auth) | `bidtogo` → https://bidtogo.vercel.app | Root Directory `apps/web`, Node 24, build `prisma generate && next build` |
| Scraper API + scheduler | `services/scraper` (FastAPI) | `bidtogo-scraper` → https://bidtogo-scraper.vercel.app | Root Directory `services/scraper`, one Python function (`api/index.py`), `maxDuration` 300 s, Vercel Cron every 5 min |
| Database | Prisma schema (`apps/web/prisma/schema.prisma`) | Neon Postgres (`neondb`) | Use the `-pooler` host for both projects |

Both projects auto-deploy from `main` of `LucasJ880/Lead-Research` (team `lucas-9039s-projects`).

## How crawling works without Celery

`source_runs` is the work queue (`src/core/runner.py`):

1. `POST /api/crawl/all` (the "Run Crawler" button) or `POST /api/crawl/{source_id}` inserts a
   `pending` row per active cloud-crawlable source. A source with a pending/running row is not
   queued twice (`status: already_running`).
2. Vercel Cron calls `GET /api/cron/tick` every 5 minutes with `Authorization: Bearer $CRON_SECRET`.
   Each tick:
   - marks runs stuck in `running` for > 20 min as failed (a killed invocation),
   - queues a `schedule` run for any active source not crawled in the last 20 h (replaces the
     daily Celery beat job),
   - claims the oldest pending run with `FOR UPDATE SKIP LOCKED` and crawls it with a wall-clock
     budget (~250 s). Keyword-driven crawlers (Biddingo, Bids&Tenders) stop at the deadline and
     resume from `sources.crawl_config.keyword_cursor` next time, so long keyword lists are
     covered across several ticks. Rows are committed one by one, so partial runs keep their data.
   - if nothing is queued it does maintenance instead: document text extraction, Chinese
     translation of pending rows, and purge of expired / SAM set-aside opportunities.
3. `GET /api/crawl/status/{run_id}` reports the run row (`PENDING` / `STARTED` / `SUCCESS` / `FAILURE`).

A full sweep of the 6 active sources takes roughly 30–60 minutes of ticks. Tunables (env):
`TICK_BUDGET_SECONDS` (250), `STALE_RUN_MINUTES` (20), `SCHEDULE_INTERVAL_HOURS` (20),
`DEFAULT_RATE_LIMIT_SECONDS` (1 on Vercel).

## Environment variables

### `bidtogo` (web)

| Variable | Value |
|----------|-------|
| `DATABASE_URL` | Neon pooler URL + `?sslmode=require&channel_binding=require&connection_limit=5&pool_timeout=20` |
| `NEXTAUTH_SECRET` | random 32 bytes |
| `NEXTAUTH_URL` | `https://bidtogo.vercel.app` → `https://bidtogo.ca` after DNS cutover |
| `SCRAPER_API_URL` | `https://bidtogo-scraper.vercel.app` |
| `SCRAPER_API_KEY` | shared secret, identical in both projects |
| `QINGYAN_ENABLED` / `QINGYAN_API_BASE` / `QINGYAN_API_TOKEN` / `QINGYAN_WEBHOOK_SECRET` | optional |
| `ENABLE_EXPERIMENTAL_COREPACK` | `1` (pnpm 10.31.0 via `packageManager`) |

### `bidtogo-scraper`

| Variable | Value |
|----------|-------|
| `DATABASE_URL` | same Neon pooler URL (Prisma-only params are stripped automatically) |
| `SCRAPER_API_KEY`, `AGENT_API_KEY` | same shared secret as the web project |
| `CRON_SECRET` | random; Vercel Cron sends it as a Bearer token |
| `OPENAI_API_KEY`, `MERX_EMAIL`, `MERX_PASSWORD`, `GOOGLE_TRANSLATE_API_KEY`, `SAM_GOV_API_KEY` | integrations |
| `DEFAULT_RATE_LIMIT_SECONDS` | `1` |
| `AI_DAILY_BUDGET_USD`, `AI_MONTHLY_BUDGET_USD` | `5`, `100` |

Set with `vercel env add NAME production` while the repo root is linked to the right project
(`vercel link --project bidtogo` / `--project bidtogo-scraper`). Deploy with `vercel deploy --prod`
from the repo root (the CLI honours each project's Root Directory), or just push to `main`.

## Fresh database setup

```bash
cd apps/web
DATABASE_URL=<neon direct url> npx prisma db push --skip-generate
DATABASE_URL=<neon direct url> npx prisma db execute --file prisma/setup-search.sql --schema prisma/schema.prisma
# admin user: create with bcrypt hash (see prisma/seed.ts — do not run the whole seed, it inserts demo opportunities)
cd ../../services/scraper
DATABASE_URL=<neon url> python -m src.seeds.sources
```

`User.role` defaults to `viewer`; the first admin must be inserted with role `owner`/`admin`.

## DNS cutover (bidtogo.ca → Vercel)

1. `vercel domains add bidtogo.ca --scope lucas-9039s-projects` on project `bidtogo` (and `www.bidtogo.ca`).
2. At GoDaddy (`bidtogo.ca` uses `ns13/ns14.domaincontrol.com`): set `A @ → 76.76.21.21` and
   `CNAME www → cname.vercel-dns.com`, delete the old `A` record pointing at `137.184.163.168`.
3. `vercel env add NEXTAUTH_URL production` = `https://bidtogo.ca`, then redeploy `bidtogo`.
4. Optionally `api.bidtogo.ca` → project `bidtogo-scraper` (then update `SCRAPER_API_URL`).

## Verifying

```bash
curl -s https://bidtogo.vercel.app/api/health
curl -s https://bidtogo-scraper.vercel.app/api/health
curl -s -H "Authorization: Bearer $CRON_SECRET" https://bidtogo-scraper.vercel.app/api/cron/tick
```

## Legacy Docker deployment

`docker-compose*.yml`, `Caddyfile`, `scripts/deploy.sh` and the Celery tasks are kept so the
service can still run self-hosted (the Celery wrappers call the same functions the runner uses).
They are not needed for Vercel.
