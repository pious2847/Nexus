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
- `evaluators/drought.ts` — **Open-Meteo historical archive** (no key) — compares the current
  30-day rainfall to a 3-year rolling "normal" for the same calendar window, raises **auto**
  `drought` events on deficit ≥40% (`classifyDrought`/`deficitPercent`/`sumWindow`, pure + tested).
  Slow-onset: `urgency: 'future'`, `certainty: 'likely'`, weekly cadence. True CHIRPS climatology
  is a future upgrade (spec 01 §17) — this is an honest v1 heuristic, not a stand-in for it.
- `evaluators/flood.ts` — **GloFAS** river discharge (spec 01 §7 lists `glofas` as a flood
  source), served as free no-key JSON by Open-Meteo's Flood API (wraps GloFAS v4, 5km, 1984→
  present) — avoids the raw CDS/netCDF path the original research flagged as needing a Python
  worker. Compares forecast max discharge (7 days) to historical daily-discharge percentiles
  (p90/p95/p98 over a 10-year record) at the same point, raises **auto** `flood` events
  (`percentile`/`classifyFloodRisk`, pure + tested). This is a **daily-percentile proxy** for
  GloFAS's own return-period alert levels (which use annual maxima) — an honest v1 heuristic,
  not a claim of methodological equivalence. Adapter: `src/integrations/glofas.ts`.

## Ingestion + scheduling
- Reusable fns in `ingestion.ts` (`ingestFirms`, `ingestRainfall`, `ingestDrought`, `ingestFlood`);
  manual CLIs: `pnpm ingest:firms`, `pnpm ingest:rainfall`, `pnpm ingest:drought`, `pnpm ingest:flood`.
- `hazards.jobs.ts` — `startHazardJobs()` schedules all four via node-cron (**FIRMS 3h, rainfall
  6h, flood 12h, drought weekly Mon 04:00**), wired into boot in `core/http/register.ts`.
  **Opt-in**: set `ENABLE_HAZARD_JOBS=true` (off by default so dev/test boots don't auto-write).
  Overlap-guarded; errors are swallowed.

## Impact-based forecasting (`impact.ts`)
When an event is raised (`HazardService.raiseEvent`), we compute who/what is in the affected
area over the geography **subtree** (ltree `<@`) and store it in `hazard_events.impact_summary`:
population + exposed facilities (schools, toilets, sanitation units, waste facilities, dump
sites), plus `districtsInScope`. A region event therefore counts across all its districts.
`summarizeImpact()` renders the one-liner ("~2.3M people · 3 schools, 5 toilets across 16
districts"). Impact failures never block event creation.
- District-level **population** is a pending data task (regions have it today).
- Facility counts come from geo-tagged `place_id` — run `backfill:place-id` for legacy data.

## National multi-hazard map (`hazardmap.*`)
Backend GeoJSON for a map frontend to consume (MASTER_PLAN Module H), mounted at
`/api/v1/hazard-map` (distinct from the legacy `/api/v1/map` sanitation-asset layers):
- `GET /hazard-map/events` — active hazard events as Features (event footprint, else place
  boundary/centroid), filterable by `type`/`severity`/`region`.
- `GET /hazard-map/districts` — a **risk choropleth**: every one of the 261 districts, colored
  by its worst currently-active hazard, **aggregated up through the region hierarchy** (an
  event raised at a region counts for every district inside it, via ltree `path <@`). Always
  261 features — a district missing boundary geometry (currently just Guan, Oti — a tracked
  Phase 0 follow-on) still appears with `geometry: null` + `hasGeometry: false` rather than
  being silently dropped, so its risk status stays visible even before it can be drawn.
- `GET /hazard-map/summary` — national active-event counts by hazard type/severity.
`hazardmap.util.ts` (`severityRank`/`rankToSeverity`/`severityColor`/`buildFeature`) is pure
+ unit-tested; `hazardmap.repository.ts` holds the SQL; `hazardmap.service.ts` shapes GeoJSON.

## What's next (remaining Phase 1 gaps — see MASTER_PLAN §11)
- Vulnerable-persons registry (N4) — the first Module N life-safety feature.
- Citizen reporting via PWA / SMS keyword intake (currently API-only).
- Risk-knowledge layer (`risk_zones`, `risk_profiles`); health-facility registry (Module D)
  to enrich impact with clinics.
