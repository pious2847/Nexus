# modules/hazards

The Multi-Hazard Early Warning core (MASTER_PLAN Module B, [spec 01](../../../../docs/specs/01-multi-hazard-ews.md)).
Phase 1 Step 1.1 — the config-driven framework + event lifecycle backbone.

## Files
- `hazards.state.ts` — pure, unit-tested lifecycle state machine (`predicted → … → closed`).
- `hazards.repository.ts` — SQL for hazard types, events, transitions, predictions.
- `hazards.service.ts` — raise/transition events (state machine enforced, transitions recorded, audited); predictions.
- `hazards.routes.ts` — `/api/v1/hazards/*` (reads public; create/transition permission-guarded + geo-scoped).
- `seed-hazard-types.ts` — seeds the hazard registry from `@nexus/shared` HAZARD_TYPES.
- DDL: `src/db/migrations/0006_hazards.sql`.

## Endpoints
- `GET  /api/v1/hazards/types`
- `GET  /api/v1/hazards/events` (filters: type, place, state, severity, limit)
- `GET  /api/v1/hazards/events/:id` (includes transitions)
- `POST /api/v1/hazards/events` — perm `hazard.event.create` (scoped to place)
- `POST /api/v1/hazards/events/:id/transition` — perm `hazard.event.transition` (scoped to event place)

## Setup
```bash
pnpm --filter nexus-backend db:migrate
pnpm --filter nexus-backend seed:hazard-types
```

## What's next (later Phase 1 increments)
- Evaluator strategies (`rules` / `external` / `ml`) + external sources: **FIRMS** (bushfire),
  **GloFAS** (floods), **CHIRPS** (drought); nationwide weather ingestion.
- Risk-knowledge layer (`risk_zones`, `risk_profiles`) + impact-based forecasting.
- Tiered warning authority + approval queue (`warning_approvals`), then alert delivery (Module F).
