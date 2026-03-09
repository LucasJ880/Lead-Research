# BidToGo — Deployment Checklist

## Pre-deployment

- [ ] `.env` file exists on server at `/opt/app/.env`
- [ ] All critical env vars are set (not placeholder values):
  - `POSTGRES_PASSWORD` — strong random password
  - `NEXTAUTH_SECRET` — `openssl rand -base64 32`
  - `SCRAPER_API_KEY` — `openssl rand -hex 16` (same for web + scraper)
  - `NEXTAUTH_URL` — `https://bidtogo.ca`
  - `MERX_EMAIL` / `MERX_PASSWORD` — real MERX credentials
  - `OPENAI_API_KEY` — real OpenAI key
  - `ADMIN_EMAIL` / `ADMIN_PASSWORD` — admin login credentials

## Deploy

```bash
cd /opt/app
git pull
bash scripts/deploy.sh
```

## Post-deployment verification

1. **Health endpoint:** `curl https://bidtogo.ca/api/health`
   - All checks should return `"ok"`
2. **Admin login:** Go to `https://bidtogo.ca` and sign in
3. **Dashboard loads:** Stats cards show source count
4. **Sources page:** Shows registered sources
5. **Run Crawler:** Click "Run Crawler" — should not return 401
6. **Scraper health:** `curl http://localhost:8001/health` (from server)

## Updating

```bash
cd /opt/app
git pull
docker compose -f docker-compose.prod.yml build
docker compose -f docker-compose.prod.yml up -d
```

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| 401 "Invalid API key" | `SCRAPER_API_KEY` mismatch between app and scraper | Ensure both services get same key from `.env` |
| "Failed to connect to scraper" | scraper-api not running | `docker compose -f docker-compose.prod.yml logs scraper-api` |
| Login fails | Wrong password hash or missing admin user | Re-run `bash scripts/deploy.sh` to re-seed |
| Database errors | Schema out of sync | `docker compose -f docker-compose.prod.yml run --rm app sh -c 'npx prisma@5.22.0 db push --skip-generate'` |
