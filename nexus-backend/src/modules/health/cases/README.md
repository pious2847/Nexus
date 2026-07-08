# modules/health/cases

Disease case reporting (Module D — Health & Disease Surveillance, MASTER_PLAN
Module D / spec gap). Clinics and field workers log suspected/confirmed cases
by disease & location; the outbreak evaluator (`modules/hazards/evaluators/outbreak.ts`)
watches the resulting counts for statistically significant spikes and raises
`disease_outbreak` hazard events.

**Epi-aggregate only, not patient records.** Every design choice reflects that:
- **No patient names/identifiers** — only `age_group` (banded) and `sex`, consistent
  with data minimization. This is deliberately *not* a clinical record system.
- **Geo-scoped RBAC** — `GET /` requires an explicit `scope` place, same pattern as
  `modules/vulnerable`, even though case data isn't PII (an unscoped national feed
  is still an easy scrape/DoS target and it keeps the RBAC model consistent).
- **Every report audited**, with minimal metadata (`disease_code` + `case_status`
  only — never `age_group`/`sex`/`notes`, since those are the closest thing to
  sensitive fields this table has).
- **`disease_code` is not validated against a fixed enum in Zod** — `disease_types`
  is the source of truth (FK); an unknown code fails at the DB layer (400, caught
  in the route handler) rather than duplicating the list in two places.

## Files
- `disease-case.repository.ts` — SQL. `listByScope` uses ltree subtree (`path <@`),
  same pattern as every other geo-scoped registry. `countByDiseaseAndPlaceInWindow`
  and `listDistinctPlacesWithRecentCases` exist specifically for the outbreak
  evaluator's weekly-bucket scanning. Also owns the `disease_types` registry
  (`upsertDiseaseType`, `listEnabledDiseaseTypes`).
- `disease-case.service.ts` — `DiseaseCaseService`: report/get/list, audited.
- `disease-case.routes.ts` — `/api/v1/health-cases/*` (not yet mounted — see
  "Needs wiring" below).
- `seed-disease-types.ts` — seeds Ghana's IDSR priority disease list (see below).
- DDL: `src/db/migrations/0011_health_surveillance.sql`.

## Endpoints (once mounted)
- `POST /api/v1/health-cases` — report a case (`health.case.create`, scoped to the place)
- `GET  /api/v1/health-cases?scope=<placeId>` — list a district/region's case reports
  (`health.case.read`; `&diseaseCode=`/`&caseStatus=`/`&from=`/`&to=` filters)
- `GET  /api/v1/health-cases/:id` — detail (`health.case.read`, scoped to the record's place)

## Permissions (packages/shared/src/constants/permissions.ts)
`health.case.create` / `health.case.read` — `district_officer` and `field_worker` get
both (create + read, geo-scoped to their assigned area, like `report.create`).
`national_agency` / `regional_coordinator` get `health.case.read` only (oversight, no
frontline reporting). `super_admin` has everything via `'*'`.

**Note for the orchestrating session:** at the time this module was built, this
permission pair did not yet exist in `permissions.ts` (the task brief assumed it
had already been added) — it was added here to make the module compile/function,
matching exactly the role grants above. Please review that edit; it's the one file
outside this module's own directory (plus the migration + its journal entry) that
was touched.

## Disease list (seed-disease-types.ts)
Ghana Health Service **IDSR (Integrated Disease Surveillance and Response) Technical
Guidelines**, 3rd edition (adapted from the WHO AFRO IDSR framework) — "Priority
diseases, conditions and events" list. 11 diseases seeded:
cholera, acute watery diarrhea (awd), measles, meningitis (CSM), yellow fever,
guinea worm disease, acute flaccid paralysis/polio, neonatal tetanus, viral
haemorrhagic fever (vhf), anthrax, rabies.

Epidemic-prone/fast-moving diseases (cholera, awd, measles, meningitis) get a
shorter `baselineWindowDays` (28-42 days) so the rolling baseline stays responsive;
near-eradication/rare diseases use the schema default (84 days / 12 weeks) — their
near-zero baseline count means almost any case is already a strong signal
regardless of window (see `outbreak.ts`'s `zScore` stdDev=0 handling).
`alertSigma` is 2 for all, matching the `disease_outbreak` hazard type's already-
seeded threshold (`thresholds: { sigma: 2 }`, `modules/hazards/seed-hazard-types.ts`).

Run: `pnpm --filter nexus-backend seed:disease-types` (script line not yet added to
package.json — see "Needs wiring").

## Needs wiring (orchestrating session)
- **`nexus-backend/src/core/http/container.ts`**: import `DiseaseCaseService` from
  `../../modules/health/cases/disease-case.service`, add `diseaseCases: DiseaseCaseService`
  to `CoreServices`, construct it in `createCoreServices` as
  `new DiseaseCaseService(db, geography, audit)`.
- **`nexus-backend/src/core/http/register.ts`**: import `buildDiseaseCaseRouter` from
  `../../modules/health/cases/disease-case.routes` and mount it —
  `app.use('/api/v1/health-cases', buildDiseaseCaseRouter(services))`.
- **`nexus-backend/package.json`** `scripts`: add
  `"seed:disease-types": "tsx src/modules/health/cases/seed-disease-types.ts"` and
  `"ingest:outbreak": "tsx src/modules/hazards/ingest-outbreak.ts"`.
- **Migration ordering**: `disease_cases.facility_id` references `health_facilities(id)`,
  which is created by the parallel facilities-registry agent's migration. If that
  migration is *also* numbered `0011`, the two need reconciling (renumber one to run
  after the other, or merge into a single migration) before `db:migrate` will succeed.
- **Scheduling (optional)**: `modules/hazards/hazards.jobs.ts` doesn't yet schedule
  the outbreak evaluator — it was left untouched since it's shared cron wiring, not
  named in this module's scope. A weekly cadence (like drought) would be the natural
  fit; case counts don't need faster-than-daily re-evaluation.

## What's next
- The `health_facilities` FK on `disease_cases` is currently unused by this module's
  own code (case reports can be submitted with `facilityId: null`); once the
  facilities registry lands, case-reporting UIs could offer a facility picker.
- Fold recent case counts into impact-based forecasting
  (`modules/hazards/impact.ts`), similar to how the vulnerable-persons registry
  is planned to feed event `impact_summary`.
