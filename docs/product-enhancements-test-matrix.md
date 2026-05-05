# Product Enhancements Test Matrix

## Backend Unit Tests

- `normalize_location_extended` handles US/CA city/state/postal parsing and confidence.
- `normalize_procurement_type` priority: source metadata > title > unknown.
- `score_opportunity` includes procurement/location/status adjustments.

## API Tests

- `PATCH /api/opportunities/{id}/business-status`
  - success path
  - `not_fit`/`archived` without reason returns `400`
  - forbidden for `viewer/client`
- `POST /api/opportunities/{id}/notes` uses session user id and noteType.
- `GET /api/opportunities/{id}/status-history` returns ordered events.
- `GET /api/opportunities/{id}/activity-timeline` merges status/note/analysis.
- `GET /api/opportunities` filters by:
  - `businessStatus`
  - `procurementType`
  - `northAmericaOnly`
  - `stateProvince`
  - `unknownLocation`

## Frontend Component Tests

- List page:
  - business status filter
  - procurement type filter
  - location checkboxes/state filter
  - row-level business status update
- Detail page:
  - business status update flow
  - timeline rendering
  - notes submission

## E2E Tests

- Sales user changes status to `archived` and provides reason.
- Viewer can read but cannot update status or create notes.
- Admin can fetch and update user roles.
- AI endpoints accept prompt template key and return analysis payload.

## Multi-Tenant Forward-Compat Tests

- New rows default `tenant_id='default_tenant'`.
- Filters and updates do not cross tenant when tenant scoping is introduced.
