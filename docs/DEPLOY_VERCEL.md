# BidToGo — Vercel Deployment (web tier)

BidToGo is **not** a single Next.js app. It has two tiers:

| Tier | What | Where it runs |
|------|------|---------------|
| Web | `apps/web` — Next.js 14 UI + `/api/*` routes, Prisma, next-auth | **Vercel** (project `bidtogo`, team `lucas-9039s-projects`) |
| Backend | PostgreSQL 16, Redis 7, Python FastAPI scraper (`services/scraper`), Celery worker + beat | Docker Compose on the DigitalOcean droplet (`docker-compose.prod.yml`) |

Vercel only runs serverless functions. It **cannot** host Postgres, Redis, or the always-on
Celery crawler processes. Until those are moved to another host (see "Retiring the droplet"),
the droplet must stay up and the Vercel deployment must be able to reach it over the internet.

## Vercel project settings

| Setting | Value |
|---------|-------|
| Root Directory | `apps/web` |
| Framework | Next.js |
| Build Command | `prisma generate && next build` |
| Node.js | 24.x |
| Package manager | pnpm 10.31.0 via corepack (`packageManager` in root `package.json`, `ENABLE_EXPERIMENTAL_COREPACK=1`) |
| Git | `LucasJ880/Lead-Research`, `main` → production |

`apps/web/next.config.js` disables `output: "standalone"` when `VERCEL` is set (standalone is
only for the Docker image) and traces `services/scraper/config/prompts/*.yaml` into the
`/api/intelligence/prompts` function.

Routes that proxy to the scraper or run heavy queries declare `export const maxDuration = 60`.

## Environment variables (Production)

| Variable | Value / source |
|----------|----------------|
| `DATABASE_URL` | Postgres reachable **from the public internet**. Append `?schema=public&connection_limit=5&pool_timeout=20` (serverless = many short-lived connections). |
| `NEXTAUTH_SECRET` | Generated fresh for Vercel (`openssl rand -base64 32`). Does not need to match the droplet. |
| `NEXTAUTH_URL` | `https://bidtogo.vercel.app` now; change to `https://bidtogo.ca` at DNS cutover. |
| `SCRAPER_API_URL` | Public base URL of the FastAPI scraper (see below). |
| `SCRAPER_API_KEY` | Same value as `SCRAPER_API_KEY` in the droplet `.env`. **Required** — `/api/crawler/trigger` refuses to run without it (the old hard-coded fallback key was removed). |
| `QINGYAN_ENABLED` / `QINGYAN_API_BASE` / `QINGYAN_API_TOKEN` / `QINGYAN_WEBHOOK_SECRET` | Copy from droplet `.env` when enabling Qingyan sync from Vercel. Set to `false` until then so two deployments do not both push. |
| `ENABLE_EXPERIMENTAL_COREPACK` | `1` |

Set with `vercel env add NAME production` from the repo root (it is linked to the project).

## Making the droplet reachable from Vercel

The compose file only publishes ports 80/443 (Caddy). Two things must be exposed:

1. **Scraper API.** The web app calls `/health`, `/api/health`, `/api/crawl/all`,
   `/api/diagnostics`, `/api/analysis/*` on `SCRAPER_API_URL`. Caddy currently only proxies
   `/api/agent/*`, `/api/analysis/*`, `/api/scraper/*`. Add a dedicated host in `Caddyfile`:

   ```
   api.bidtogo.ca {
       reverse_proxy scraper-api:8001
   }
   ```

   plus an `A` record `api.bidtogo.ca → 137.184.163.168` at GoDaddy (bidtogo.ca DNS is on
   `ns13/ns14.domaincontrol.com`). All mutating scraper routes require `X-API-Key`; `/health`
   is public and harmless. Then set `SCRAPER_API_URL=https://api.bidtogo.ca`.

2. **PostgreSQL.** Either
   - publish `5432` on the droplet (`ports: ["5432:5432"]` on the `postgres` service), enable
     `ssl = on` in Postgres, and use `?sslmode=require` in `DATABASE_URL`, or
   - (recommended) move the database to a managed Postgres (Neon / Supabase / DigitalOcean
     Managed DB) with `pg_dump` → `pg_restore`, then point **both** Vercel and the scraper
     containers at it. This is the first step of retiring the droplet anyway.

## DNS cutover (bidtogo.ca → Vercel)

1. `vercel domains add bidtogo.ca` (and `www.bidtogo.ca`) on project `bidtogo`.
2. At GoDaddy: `A bidtogo.ca → 76.76.21.21`, `CNAME www → cname.vercel-dns.com`.
   Keep `api.bidtogo.ca → droplet`.
3. Update `NEXTAUTH_URL=https://bidtogo.ca` on Vercel and redeploy.
4. Remove the `bidtogo.ca` site block from `Caddyfile` (keep `api.bidtogo.ca`) so the droplet
   stops serving the old UI; the `/api/agent/*` endpoint used by external agents must then be
   called on `api.bidtogo.ca`.

## Retiring the droplet

Only possible after all three move: Postgres (managed DB), Redis (Upstash / managed Redis),
and the scraper API + Celery worker + beat (Railway, Render, Fly.io, or DigitalOcean App
Platform — anything that runs the existing `services/scraper/Dockerfile` as long-running
services). The Celery beat schedule is what drives automatic crawling; without it nothing new
is ingested.

## Schema note

`User.role` now defaults to `viewer` (it used to default to `admin`). Apply it to the database
with `prisma db push` (the droplet's `scripts/deploy.sh` already does this). Existing rows are
not changed; only inserts that omit `role` are affected.

## Verifying a deployment

```bash
curl -s https://bidtogo.vercel.app/api/health
```

`database`, `scraper`, `environment`, `sources`, `admin` should all be `ok`.
