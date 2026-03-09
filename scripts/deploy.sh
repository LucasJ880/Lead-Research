#!/usr/bin/env bash
set -euo pipefail

echo "═══════════════════════════════════════════"
echo " BidToGo — Production Deployment"
echo "═══════════════════════════════════════════"

# ── 0. Check .env exists ──────────────────────────────────
if [ ! -f .env ]; then
  echo "ERROR: .env file not found."
  echo "Copy .env.production.example to .env and fill in your values:"
  echo "  cp .env.production.example .env && nano .env"
  exit 1
fi

set -a; source .env; set +a

# ── 1. Validate critical env vars ─────────────────────────
ERRORS=0

check_var() {
  local var_name="$1"
  local var_val="${!var_name:-}"
  local placeholder="${2:-}"

  if [ -z "$var_val" ]; then
    echo "  MISSING: $var_name"
    ERRORS=$((ERRORS + 1))
  elif [ -n "$placeholder" ] && [ "$var_val" = "$placeholder" ]; then
    echo "  DEFAULT: $var_name still has placeholder value"
    ERRORS=$((ERRORS + 1))
  fi
}

echo ""
echo "Validating environment..."
check_var "POSTGRES_PASSWORD" "CHANGE_ME_STRONG_PASSWORD"
check_var "NEXTAUTH_SECRET" "CHANGE_ME_GENERATE_WITH_OPENSSL"
check_var "SCRAPER_API_KEY" "CHANGE_ME_RANDOM_KEY"
check_var "NEXTAUTH_URL"

if [ "$ERRORS" -gt 0 ]; then
  echo ""
  echo "ERROR: $ERRORS critical env var(s) missing or using defaults."
  echo "Edit .env and try again."
  exit 1
fi

echo "  All critical vars OK"

echo ""
echo "  SCRAPER_API_KEY set:    yes (length ${#SCRAPER_API_KEY})"
echo "  MERX_EMAIL set:         $([ -n "${MERX_EMAIL:-}" ] && echo yes || echo no)"
echo "  OPENAI_API_KEY set:     $([ -n "${OPENAI_API_KEY:-}" ] && echo yes || echo no)"
echo "  NEXTAUTH_URL:           ${NEXTAUTH_URL}"

# ── 2. Build containers ──────────────────────────────────
echo ""
echo "1/6  Building containers..."
docker compose -f docker-compose.prod.yml build

# ── 3. Start database and redis ──────────────────────────
echo ""
echo "2/6  Starting database and redis..."
docker compose -f docker-compose.prod.yml up -d postgres redis
echo "     Waiting for postgres..."
until docker compose -f docker-compose.prod.yml exec -T postgres pg_isready -U "${POSTGRES_USER:-leadharvest}" > /dev/null 2>&1; do
  sleep 2
done
echo "     PostgreSQL is ready."

# ── 4. Run migrations ────────────────────────────────────
echo ""
echo "3/6  Running database migrations..."
docker compose -f docker-compose.prod.yml run --rm app sh -c \
  'npx prisma@5.22.0 db push --accept-data-loss --skip-generate' 2>&1 | tail -5

# ── 5. Seed admin user ───────────────────────────────────
echo ""
echo "4/6  Ensuring admin user exists..."
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@bidtogo.ca}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-changeme}"
# Generate bcrypt hash inside a node one-liner
HASH=$(docker compose -f docker-compose.prod.yml run --rm app node -e "
  const b=require('bcryptjs');
  b.hash('${ADMIN_PASSWORD}',12).then(h=>console.log(h));
" 2>/dev/null | tail -1)

if [ -n "$HASH" ]; then
  docker compose -f docker-compose.prod.yml exec -T postgres psql \
    -U "${POSTGRES_USER:-leadharvest}" -d "${POSTGRES_DB:-leadharvest}" -c "
    INSERT INTO users (id, email, password_hash, name, role, created_at, updated_at)
    VALUES (gen_random_uuid(), '${ADMIN_EMAIL}', '${HASH}', 'Admin', 'admin', NOW(), NOW())
    ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash;
  " > /dev/null 2>&1
  echo "     Admin: ${ADMIN_EMAIL}"
else
  echo "     WARNING: Could not hash password, skipping admin seed."
  echo "     Admin user must already exist in database."
fi

# ── 6. Start all services ────────────────────────────────
echo ""
echo "5/6  Starting all services..."
docker compose -f docker-compose.prod.yml up -d

echo ""
echo "6/6  Waiting for services to stabilize..."
sleep 8

# ── 7. Health check ──────────────────────────────────────
echo ""
echo "Running health checks..."
HEALTH=$(docker compose -f docker-compose.prod.yml exec -T app \
  node -e "fetch('http://localhost:3000/api/health').then(r=>r.json()).then(j=>console.log(JSON.stringify(j,null,2))).catch(e=>console.log('FAIL:',e.message))" 2>/dev/null || echo '{"status":"unknown"}')
echo "$HEALTH"

echo ""
echo "═══════════════════════════════════════════"
echo " Deployment complete!"
echo ""
echo " Site:     ${NEXTAUTH_URL:-https://bidtogo.ca}"
echo " Admin:    ${ADMIN_EMAIL}"
echo " Health:   ${NEXTAUTH_URL}/api/health"
echo ""
echo " Commands:"
echo "   Status:  docker compose -f docker-compose.prod.yml ps"
echo "   Logs:    docker compose -f docker-compose.prod.yml logs -f app"
echo "   Update:  git pull && bash scripts/deploy.sh"
echo "═══════════════════════════════════════════"
