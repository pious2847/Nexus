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

## Evaluators (external data → auto events)
- `evaluators/bushfire.ts` — **NASA FIRMS** active-fire ingestion. Groups detections by district,
  classifies severity (`classifyBushfire`, pure + tested), raises/updates **auto** `bushfire`
  events (state `watch`, certainty `observed`) with provenance (`sources: ['firms']`). Dedup: one
  open auto event per district / 24h. Adapter: `src/integrations/firms.ts` (needs `FIRMS_MAP_KEY`).
- `evaluators/rainfall.ts` — **Open-Meteo** (no key) forecast precipitation → **auto**
  `heavy_rainfall` events (`classifyRainfall`, pure + tested). Adapter: `src/integrations/openMeteo.ts`.

## Ingestion + scheduling
- Reusable fns in `ingestion.ts` (`ingestFirms`, `ingestRainfall`); manual CLIs:
  `pnpm ingest:firms`, `pnpm ingest:rainfall`.
- `hazards.jobs.ts` — `startHazardJobs()` schedules both via node-cron (**FIRMS 3h, rainfall 6h**),
  wired into boot in `core/http/register.ts`. **Opt-in**: set `ENABLE_HAZARD_JOBS=true`
  (off by default so dev/test boots don't auto-write). Overlap-guarded; errors are swallowed.

## What's next (later Phase 1 increments)
- More evaluators + sources: **GloFAS** (floods), **CHIRPS** (drought); nationwide weather ingestion.
- Risk-knowledge layer (`risk_zones`, `risk_profiles`) + impact-based forecasting.
- Tiered warning authority + approval queue (`warning_approvals`), then alert delivery (Module F).
