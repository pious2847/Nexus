# N15 — Rapid damage & needs assessment

A structured post-event assessment: households affected, casualties,
damaged infrastructure, urgent needs — geo-tagged, submitted via mobile
forms in the field. Auto-rolls up into a **situation report** (a live
aggregation across a scope/hazard event, computed on request — not a
separate stored document).

Schema: `src/db/migrations/0021_damage_assessments_facility_capacity.sql`
(`damage_assessments` table; `facility_capacity_status` in the same
migration belongs to the sibling N16 module, not this one).

## Files

- `assessment.repository.ts` — raw SQL (Drizzle `sql` tag) data access:
  `insertAssessment`, `getAssessment`, `assessmentPlacePath` (RBAC scope
  checks on `:id` routes), `listAssessmentsByScope` (ltree subtree scope,
  optional `hazardEventId` filter), `situationReport` (the roll-up
  aggregation: `SUM`s of households/persons affected, casualties, injuries,
  total assessment count, plus an urgent-needs breakdown via
  `unnest(urgent_needs)` + `GROUP BY`). Uses a `textArray()` helper for the
  `urgent_needs text[]` column — copied verbatim from
  `shelter.repository.ts` — because a bare JS array interpolated into a
  Drizzle `sql` template becomes a Postgres tuple, not an array literal.
  Geometry is inserted via `ST_SetSRID(ST_MakePoint(lng, lat), 4326)` and
  selected back via `ST_X(geometry) AS lng, ST_Y(geometry) AS lat` (mirrors
  `sos.repository.ts`).
- `assessment.service.ts` — `AssessmentService(db, geography, audit?)`
  (same optional-audit pattern as `ShelterService`; every `submit()` is
  audited, no-op if `audit` is undefined). Methods: `submit`,
  `getAssessment`, `listByScope`, `situationReport`, `assessmentPlacePath`,
  `resolvePlace(lng?, lat?)` (reverse-geocodes to a district id via
  `geography.districtForPoint`, mirrors `ShelterService.resolvePlace`).
- `assessment.routes.ts` — `buildAssessmentRouter({ assessments, geography, rbac })`,
  deps typed as `Pick<CoreServices, 'geography' | 'rbac'> & { assessments: AssessmentService }`
  so this type-checks standalone before wiring. Routes:
  - `POST /` (`assessment.create`) — submit an assessment; resolves place
    from `placeId` or `lng`/`lat` via the same `resolveTargetPlace`
    middleware pattern as `shelter.routes.ts`.
  - `GET /sitrep?scope=&hazardEventId=` (`assessment.read`) — the situation
    report; `scope` required (400 if missing). Registered before `/:id` so
    the literal `sitrep` segment isn't swallowed by the `:id` param route.
  - `GET /?scope=&hazardEventId=` (`assessment.read`) — list; `scope`
    required (400 if missing).
  - `GET /:id` (`assessment.read`, scoped via `assessmentPlacePath`).

Permissions (`assessment.create`, `assessment.read`) were already added to
`packages/shared/src/constants/permissions.ts` in commit `7caa379`, along
with the schema migration.

## Wiring needed (orchestrator TODO — NOT done in this module)

This module only creates new files under `src/modules/assessments/`. It
does **not** edit `container.ts`, `register.ts`, or `permissions.ts`. To
integrate:

1. **`container.ts`** — add to `CoreServices`:
   ```ts
   assessments: AssessmentService;
   ```
   Import and construct it (same 3-arg pattern as `ShelterService`):
   ```ts
   import { AssessmentService } from '../../modules/assessments/assessment.service';
   // ...
   assessments: new AssessmentService(db, geography, audit),
   ```

2. **`register.ts`** — mount the router:
   ```ts
   import { buildAssessmentRouter } from '../../modules/assessments/assessment.routes';
   // ...
   app.use('/api/v1/assessments', buildAssessmentRouter(services));
   ```

## Testing note

No DB-gated integration tests are included here (per build instructions —
the orchestrator verifies live, once, after integrating all three parallel
modules built this round, to avoid concurrent-agent DB pollution on the
shared Neon dev database).
