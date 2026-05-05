# Product Enhancements Rollout

## Flags

- `enable_business_status_v2`
- `enable_procurement_filter`
- `enable_location_v2`
- `enable_rbac_v2`

## Sequence

1. Apply Prisma migration `20260505_product_enhancements_phase1`.
2. Run `python services/scraper/backfill_product_enhancements.py`.
3. Deploy web API and scraper with flags off (dual-write compatible).
4. Enable `enable_business_status_v2` for internal users.
5. Enable `enable_procurement_filter` and `enable_location_v2`.
6. Enable `enable_rbac_v2` after role backfill and smoke checks.

## Rollback

- Turn off flags first.
- Keep additive schema columns/tables in place.
- Revert web/scraper code if needed.
- No destructive schema rollback required.

## Smoke Checklist

- Update business status in list and detail; reason required for `not_fit`/`archived`.
- Notes are saved with current user (not hardcoded admin).
- Status history and activity timeline return expected records.
- Opportunity filters work for procurement type and north-america dimensions.
- AI prompt templates endpoint returns YAML metadata.
