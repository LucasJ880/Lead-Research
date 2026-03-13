#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_DIR"

COMPOSE="docker compose -f docker-compose.prod.yml"
DEPLOY_TS=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
NO_CACHE="${NO_CACHE:-}"
SKIP_PULL="${SKIP_PULL:-}"

# Ensure git trusts this directory (needed when running as root on a deploy-owned repo)
git config --global --add safe.directory "$PROJECT_DIR" 2>/dev/null || true

echo "═══════════════════════════════════════════"
echo " BidToGo — Production Deployment"
echo " $DEPLOY_TS"
echo "═══════════════════════════════════════════"

# ── 0. Pull latest code from GitHub ──────────────────────
if [ -z "$SKIP_PULL" ]; then
  echo ""
  echo "0/7  Pulling latest code from GitHub..."
  BEFORE=$(git rev-parse --short HEAD)
  git pull --ff-only origin main
  AFTER=$(git rev-parse --short HEAD)
  if [ "$BEFORE" = "$AFTER" ]; then
    echo "     Already up to date ($AFTER)"
  else
    echo "     Updated: $BEFORE → $AFTER"
    git log --oneline "${BEFORE}..${AFTER}" | head -10
  fi
else
  echo ""
  echo "0/7  Skipping git pull (SKIP_PULL=1)"
fi

# ── 1. Check .env exists — offer to create if missing ────
if [ ! -f .env ]; then
  echo ""
  echo "══════════════════════════════════════════════════════════"
  echo " ERROR: .env file not found at $(pwd)/.env"
  echo "══════════════════════════════════════════════════════════"
  echo ""
  echo " Option A — Generate a new .env from template:"
  echo ""
  echo "   cp .env.production.example .env"
  echo "   nano .env"
  echo ""
  echo " Option B — Quick-generate with random secrets:"
  echo ""
  echo "   cat > .env << 'ENVEOF'"
  echo "   POSTGRES_PASSWORD=$(openssl rand -hex 16)"
  echo "   NEXTAUTH_SECRET=$(openssl rand -base64 32)"
  echo "   NEXTAUTH_URL=https://bidtogo.ca"
  echo "   SCRAPER_API_KEY=$(openssl rand -hex 16)"
  echo "   OPENAI_API_KEY=sk-your-key-here"
  echo "   ADMIN_EMAIL=admin@bidtogo.ca"
  echo "   ADMIN_PASSWORD=$(openssl rand -hex 8)"
  echo "   ENVEOF"
  echo ""
  echo " Then re-run:  bash scripts/deploy.sh"
  echo "══════════════════════════════════════════════════════════"
  exit 1
fi

set -a; source .env; set +a

# ── 2. Validate critical env vars ───────────────────────
#    These 4 have NO defaults in docker-compose.prod.yml.
#    If any are missing or placeholder, deployment will fail.
ERRORS=0

check_var() {
  local var_name="$1"
  local var_val="${!var_name:-}"
  local placeholder="${2:-}"

  if [ -z "$var_val" ]; then
    echo "  ✗ MISSING:     $var_name"
    ERRORS=$((ERRORS + 1))
  elif [ -n "$placeholder" ] && [ "$var_val" = "$placeholder" ]; then
    echo "  ✗ PLACEHOLDER: $var_name (still set to '$placeholder')"
    ERRORS=$((ERRORS + 1))
  else
    echo "  ✓ $var_name"
  fi
}

echo ""
echo "1/7  Validating environment..."
echo ""
echo "  Critical (no defaults — must be set):"
check_var "POSTGRES_PASSWORD" "CHANGE_ME_STRONG_PASSWORD"
check_var "NEXTAUTH_SECRET"   "CHANGE_ME_GENERATE_WITH_OPENSSL"
check_var "SCRAPER_API_KEY"   "CHANGE_ME_RANDOM_KEY"
check_var "NEXTAUTH_URL"

if [ "$ERRORS" -gt 0 ]; then
  echo ""
  echo "  FATAL: $ERRORS critical variable(s) missing or using placeholder values."
  echo "  Edit .env and re-run:  nano .env && bash scripts/deploy.sh"
  exit 1
fi

echo ""
echo "  Optional (have safe defaults or degrade gracefully):"
echo "  OPENAI_API_KEY:       $([ -n "${OPENAI_API_KEY:-}" ] && echo "set (AI analysis enabled)" || echo "not set (rule-based fallback only)")"
echo "  MERX_EMAIL:           $([ -n "${MERX_EMAIL:-}" ] && echo "set" || echo "not set (MERX crawling disabled)")"
echo "  AI_DAILY_BUDGET_USD:  ${AI_DAILY_BUDGET_USD:-5}"
echo "  AI_MONTHLY_BUDGET_USD:${AI_MONTHLY_BUDGET_USD:-100}"
echo "  ADMIN_EMAIL:          ${ADMIN_EMAIL:-admin@bidtogo.ca}"

# ── 3. Build containers ─────────────────────────────────
echo ""
echo "2/7  Building containers..."
BUILD_ARGS=""
if [ -n "$NO_CACHE" ]; then
  BUILD_ARGS="--no-cache"
  echo "     (no-cache build)"
fi
$COMPOSE build $BUILD_ARGS

# ── 4. Start database and redis ─────────────────────────
echo ""
echo "3/7  Starting database and redis..."
$COMPOSE up -d postgres redis
echo "     Waiting for postgres..."
WAIT=0
until $COMPOSE exec -T postgres pg_isready -U "${POSTGRES_USER:-leadharvest}" > /dev/null 2>&1; do
  sleep 2
  WAIT=$((WAIT + 2))
  if [ "$WAIT" -ge 60 ]; then
    echo "     FATAL: PostgreSQL did not become ready within 60s"
    $COMPOSE logs --tail=20 postgres
    exit 1
  fi
done
echo "     PostgreSQL is ready. (${WAIT}s)"

# ── 5. Run database migrations ──────────────────────────
echo ""
echo "4/7  Running database migrations (prisma db push)..."
$COMPOSE run --rm app sh -c \
  'npx prisma@5.22.0 db push --accept-data-loss --skip-generate' 2>&1 | tail -5

# ── 6. Seed admin user ──────────────────────────────────
echo ""
echo "5/7  Ensuring admin user exists..."
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@bidtogo.ca}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-changeme}"
HASH=$($COMPOSE run --rm app node -e "
  const b=require('bcryptjs');
  b.hash('${ADMIN_PASSWORD}',12).then(h=>console.log(h));
" 2>/dev/null | tail -1)

if [ -n "$HASH" ]; then
  $COMPOSE exec -T postgres psql \
    -U "${POSTGRES_USER:-leadharvest}" -d "${POSTGRES_DB:-leadharvest}" -c "
    INSERT INTO users (id, email, password_hash, name, role, created_at, updated_at)
    VALUES (gen_random_uuid(), '${ADMIN_EMAIL}', '${HASH}', 'Admin', 'admin', NOW(), NOW())
    ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash;
  " > /dev/null 2>&1
  echo "     Admin: ${ADMIN_EMAIL}"
else
  echo "     WARNING: Could not hash password, skipping admin seed."
fi

echo ""
echo "     Seeding sources..."
$COMPOSE run --rm scraper-api \
  python -m src.seeds.sources 2>&1 | tail -10
echo "     Sources seeded."

# ── 7. Start all services ───────────────────────────────
echo ""
echo "6/7  Starting all services..."
$COMPOSE up -d

echo ""
echo "7/7  Waiting for services to stabilize..."
sleep 8

# ── 8. Health checks ────────────────────────────────────
echo ""
echo "Running health checks..."

APP_HEALTH=$($COMPOSE exec -T app \
  node -e "fetch('http://localhost:3000/api/health').then(r=>r.json()).then(j=>console.log(JSON.stringify(j))).catch(e=>console.log('{\"status\":\"fail\",\"error\":\"'+e.message+'\"}'))" 2>/dev/null || echo '{"status":"unknown"}')
echo "  App:     $APP_HEALTH"

SCRAPER_HEALTH=$($COMPOSE exec -T scraper-api \
  python -c "import urllib.request,json;r=urllib.request.urlopen('http://localhost:8001/health');print(json.loads(r.read()))" 2>/dev/null || echo '{"status":"unknown"}')
echo "  Scraper: $SCRAPER_HEALTH"

SERVICES=$($COMPOSE ps --format "table {{.Name}}\t{{.Status}}" 2>/dev/null || $COMPOSE ps)
echo ""
echo "Service status:"
echo "$SERVICES"

# ── 9. Summary ──────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════"
echo " Deployment complete!"
echo " Commit:   $(git rev-parse --short HEAD)"
echo " Time:     $DEPLOY_TS"
echo ""
echo " Site:     ${NEXTAUTH_URL:-https://bidtogo.ca}"
echo " Admin:    ${ADMIN_EMAIL}"
echo " Health:   ${NEXTAUTH_URL}/api/health"
echo ""
echo " Commands:"
echo "   Status:   docker compose -f docker-compose.prod.yml ps"
echo "   Logs:     docker compose -f docker-compose.prod.yml logs -f app"
echo "   Redeploy: bash scripts/deploy.sh"
echo "   Clean:    NO_CACHE=1 bash scripts/deploy.sh"
echo "═══════════════════════════════════════════"
