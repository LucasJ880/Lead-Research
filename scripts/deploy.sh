#!/usr/bin/env bash
set -euo pipefail

echo "═══════════════════════════════════════════"
echo " LeadHarvest — Production Deployment"
echo "═══════════════════════════════════════════"

# Check .env exists
if [ ! -f .env ]; then
  echo "ERROR: .env file not found."
  echo "Copy .env.production to .env and fill in your values first:"
  echo "  cp .env.production .env && nano .env"
  exit 1
fi

# Source .env for variable checks
set -a; source .env; set +a

if [ "${POSTGRES_PASSWORD:-}" = "CHANGE_ME_TO_A_STRONG_PASSWORD" ] || [ -z "${POSTGRES_PASSWORD:-}" ]; then
  echo "ERROR: You must change POSTGRES_PASSWORD in .env"
  exit 1
fi

if [ "${NEXTAUTH_SECRET:-}" = "CHANGE_ME_GENERATE_WITH_OPENSSL" ] || [ -z "${NEXTAUTH_SECRET:-}" ]; then
  echo "ERROR: You must set NEXTAUTH_SECRET in .env"
  echo "Generate one with: openssl rand -base64 32"
  exit 1
fi

echo ""
echo "1/5  Building containers..."
docker compose -f docker-compose.prod.yml build

echo ""
echo "2/5  Starting database and redis..."
docker compose -f docker-compose.prod.yml up -d postgres redis
echo "     Waiting for postgres to be healthy..."
sleep 5
until docker compose -f docker-compose.prod.yml exec -T postgres pg_isready -U "${POSTGRES_USER:-leadharvest}" > /dev/null 2>&1; do
  sleep 2
done
echo "     PostgreSQL is ready."

echo ""
echo "3/5  Running database migrations..."
docker compose -f docker-compose.prod.yml run --rm app sh -c "npx prisma migrate deploy 2>/dev/null || npx prisma db push --accept-data-loss"

echo ""
echo "4/5  Seeding admin user and base data..."
docker compose -f docker-compose.prod.yml run --rm \
  -e ADMIN_EMAIL="${ADMIN_EMAIL:-admin@leadharvest.io}" \
  -e ADMIN_PASSWORD="${ADMIN_PASSWORD:-changeme123}" \
  app sh -c "npx prisma db seed"

echo ""
echo "5/5  Starting all services..."
docker compose -f docker-compose.prod.yml up -d

echo ""
echo "═══════════════════════════════════════════"
echo " Deployment complete!"
echo ""
echo " Site:    ${NEXTAUTH_URL:-http://localhost}"
echo " Admin:   ${ADMIN_EMAIL:-admin@leadharvest.io}"
echo ""
echo " Check status:  docker compose -f docker-compose.prod.yml ps"
echo " View logs:     docker compose -f docker-compose.prod.yml logs -f app"
echo "═══════════════════════════════════════════"
