# modules/health/facilities

The health-facility registry (Module D — Health & Disease Surveillance). A
geo-tagged directory of clinics, hospitals, CHPS compounds, and health centers,
so responders and health surveillance workflows know what capacity exists where
(bed counts, ownership, contact details) — independent of the disease-case /
outbreak-detection pipeline built in `modules/health/cases/` (a parallel piece
of this same feature, not touched by this module).

Unlike the vulnerable-persons registry, this is **not** sensitive personal
data — it's public infrastructure data. Design choices reflect that:
- **Geo-scoped RBAC, but broader read access** — `GET /` still requires an
  explicit `scope` place (no "list every facility nationally" endpoint), but
  `field_worker` can read (map layer) even though they can't register/manage.
- **Registration is an officer's job** — `district_officer`+ create; regional/
  national roles get read+manage (oversight) but not create (they don't
  register facilities themselves).
- **Every mutation audited** (`health.facility.registered`, `health.facility.updated`,
  `health.facility.capacity_reported`).
- **Partial updates** — `PATCH /:id` only touches the fields you send.

### N16 — live capacity & mass-casualty coordination
Extends the static registry above with a live, frequently-updated capacity
layer: bed/blood/ambulance availability during emergencies, so casualties get
routed to a facility that actually has room. Backed by
`facility_capacity_status` (migration `0021_damage_assessments_facility_capacity.sql`),
a **time series, not updated in place** — every report is a new row; "current
status" is always the latest row per facility (`ORDER BY reported_at DESC LIMIT 1`).
Reuses the existing `health.facility.read`/`health.facility.manage` grants —
no new permissions needed. The nearest-facility lookup is public/unauthenticated,
same openness level as `shelter.routes.ts`'s `/nearest`.

## Files
- `health-facility.repository.ts` — SQL via Drizzle's `sql` tag (matches
  `vulnerable.repository.ts`'s style exactly); `listByScope` uses ltree subtree
  (`path <@`), same pattern as the vulnerable-persons / hazard-map modules.
- `health-facility.service.ts` — `HealthFacilityService`: register/get/
  facilityPlacePath/listByScope/update/resolvePlace, mutations audited.
- `health-facility.routes.ts` — `buildHealthFacilityRouter(...)`, intended
  mount: `/api/v1/health-facilities`.
- `health-facility.integration.test.ts` — **stub only**, gated by
  `RUN_DB_TESTS=1`, not executed by this agent (see "Testing" below).
- DDL: `src/db/migrations/0011_health_surveillance.sql` (`health_facilities`
  table — see the task spec for the exact schema; as of this writing the file
  was not present in this worktree's git history, see "Known gaps" below).

## Endpoints
- `POST /api/v1/health-facilities` — register (`health.facility.create`,
  scoped to the resolved place from `placeId` or `lng`/`lat`)
- `GET  /api/v1/health-facilities?scope=<placeId>` — list a district/region's
  facilities (`health.facility.read`; `&facilityType=`/`&status=` filters)
- `GET  /api/v1/health-facilities/:id` — detail (`health.facility.read`,
  scoped to the record's place)
- `PATCH /api/v1/health-facilities/:id` — partial update of name/type/
  ownership/phone/bed_count/status (`health.facility.manage`)
- `POST /api/v1/health-facilities/:id/capacity` — file a new live capacity
  report (`bedsAvailable?`, `bloodUnitsAvailable?`, `ambulancesAvailable?`,
  `status: normal|strained|overwhelmed|closed`) (`health.facility.manage`,
  scoped to the facility's place). Always inserts a new row.
- `GET  /api/v1/health-facilities/:id/capacity` — latest capacity report
  (`health.facility.read`, scoped). `200 {data: null}` if no report has ever
  been filed — that's a valid state, not an error; only an unknown facility id 404s.
- `GET  /api/v1/health-facilities/nearest-with-capacity?lng=&lat=&minBeds=&status=&limit=`
  — **PUBLIC, no auth**, mirrors `shelter.routes.ts`'s `/nearest`. Nearest
  facility with a non-closed capacity report meeting the optional `minBeds`/
  `status` filters, via PostGIS KNN (`<->`) over each facility's latest report.

## Data
`facility_type`: `clinic | hospital | chps_compound | health_center` (default `clinic`).
`ownership`: `government | private | mission | ngo` (optional).
`status`: `active | closed` (default `active`).
`name` (2-200 chars), `contact_phone` (optional), `bed_count` (optional, ≥ 0).

## Permissions (packages/shared/src/constants/permissions.ts)
`health.facility.create` / `.read` / `.manage`, per the role grants below.
`super_admin` gets everything via `'*'`. **Known gap:** these three keys and
their role-grant entries were not present in `permissions.ts` in this worktree
(that file is explicitly out of scope for this module — see "Known gaps").

| Role | create | read | manage |
|---|---|---|---|
| super_admin | y (`*`) | y | y |
| national_agency | – | y | y |
| regional_coordinator | – | y | y |
| district_officer | y | y | y |
| field_worker | – | y | – |

## Testing
This module is thin CRUD with no non-trivial pure logic (unlike, say,
`vulnerable.priority.ts`'s evacuation-priority sort), so per the task spec no
unit tests were forced. A DB-gated integration test
(`health-facility.integration.test.ts`) is included as a stub, mirroring
`vulnerable.integration.test.ts`'s structure (register → scoped list → partial
update → audit → RBAC scope enforcement), but it was **not executed** — the
orchestrating session runs the live-DB integration test itself against the
shared dev database to avoid concurrent-write conflicts with the parallel
disease-cases module's own DB tests.

## Known gaps / wiring needed (out of this module's scope)
1. **`packages/shared/src/constants/permissions.ts`** did not yet contain
   `health.facility.create` / `.read` / `.manage` in this worktree. `health-facility.routes.ts`
   works around this locally with an `as unknown as Permission` cast (see the
   comment at the top of that file) so the module type-checks standalone; once
   the three keys + role grants below are added to `permissions.ts`, the casts
   become redundant but harmless:
   ```ts
   'health.facility.create': 'Register a health facility',
   'health.facility.read': 'View the health facility registry',
   'health.facility.manage': 'Update / close a health facility record',
   ```
   Role grants: add `'health.facility.read', 'health.facility.manage'` to
   `national_agency` and `regional_coordinator`; add
   `'health.facility.create', 'health.facility.read', 'health.facility.manage'`
   to `district_officer`; add `'health.facility.read'` to `field_worker`.

2. **`src/db/migrations/0011_health_surveillance.sql`** (the `health_facilities`
   table) was not present in this worktree's git history at the time this
   module was written — the task described it as "already applied to the dev
   database". This module was built directly against the `CREATE TABLE`
   definition supplied in the task spec. Confirm the migration file itself
   gets committed (likely shared with the parallel `modules/health/cases/`
   migration in the same `0011_health_surveillance.sql`, alongside a
   `health_cases` table) and that `meta/_journal.json` gets an entry for it.

3. **`src/core/http/container.ts`** — add:
   ```ts
   import { HealthFacilityService } from '../../modules/health/facilities/health-facility.service';
   // in CoreServices:
   healthFacilities: HealthFacilityService;
   // in createCoreServices():
   healthFacilities: new HealthFacilityService(db, geography, audit),
   ```

4. **`src/core/http/register.ts`** — add:
   ```ts
   import { buildHealthFacilityRouter } from '../../modules/health/facilities/health-facility.routes';
   // ...
   app.use('/api/v1/health-facilities', buildHealthFacilityRouter(services));
   ```
   (`buildHealthFacilityRouter` accepts `{ healthFacilities, geography, rbac }`,
   which a full `CoreServices` object satisfies once item 3 is done.)
