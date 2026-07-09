# modules/response/shelters

The shelter / safe-zone registry (Module M — Emergency Response &
Coordination, sub-module M1). A geo-tagged directory of shelters with live
occupancy tracking, so responders and citizens know where safe capacity
exists during an active hazard event. Independent of the dispatch/tasking
and volunteer/asset coordination modules built in parallel under
`modules/response/dispatch/` and `modules/response/volunteers/` (not touched
here).

Like the health-facility registry, this is public infrastructure data, not
sensitive PII. Design choices reflect that:
- **Geo-scoped RBAC, but broader read access** — `GET /` still requires an
  explicit `scope` place, but `field_worker` and `community_moderator` can
  read (map layer) even though they can't register/manage.
- **Registration is an officer's job** — `district_officer` gets create;
  regional/national roles get read+manage (oversight) but not create.
  `ngo_partner` gets read only on shelters (their write access is on relief
  inventory, see `modules/response/relief/`).
- **Occupancy is a first-class, audited operation** — `POST /:id/occupancy`
  atomically adjusts `current_occupancy` (clamped at 0) and auto-transitions
  `status` between `open` and `full` based on `capacity`, without ever
  auto-reopening a shelter that was explicitly `closed`.
- **`GET /nearest` is intentionally public** — no auth, no RBAC. During an
  active event, a citizen needs to find the nearest open shelter; this is
  held to the same openness level as the hazard map.
- **Every mutation audited** (`shelter.registered`, `shelter.updated`,
  `shelter.occupancy_changed`).

## Files
- `shelter.repository.ts` — SQL via Drizzle's `sql` tag (matches
  `health-facility.repository.ts`'s style); `listByScope` uses ltree subtree
  (`path <@`); `findNearestOpen` uses PostGIS KNN (`geometry <-> point`),
  mirroring `geography.repository.ts`'s `findNearest`.
- `shelter.service.ts` — `ShelterService`: register/get/shelterPlacePath/
  listByScope/update/adjustOccupancy/findNearestOpen/resolvePlace.
- `shelter.routes.ts` — `buildShelterRouter(...)`, intended mount:
  `/api/v1/shelters`.
- No standalone unit tests: this is thin CRUD plus one small pure-ish rule
  (the full/open threshold), which is exercised directly inside
  `adjustOccupancy` against a real row rather than as an isolable pure
  function — same call as `health-facility`'s precedent (no unit tests
  forced where there's nothing non-trivial to isolate). DB-gated integration
  testing is left to the orchestrating session (see task constraints).

## Endpoints
- `POST /api/v1/shelters` — register (`shelter.create`, scoped to the
  resolved place from `placeId` or `lng`/`lat`)
- `GET  /api/v1/shelters?scope=<placeId>` — list a district/region's
  shelters (`shelter.read`; `&status=`/`&hasCapacity=true` filters)
- `GET  /api/v1/shelters/:id` — detail (`shelter.read`, scoped to the
  record's place)
- `PATCH /api/v1/shelters/:id` — partial update of name/capacity/status/
  contact_phone/notes/facilities (`shelter.manage`)
- `POST /api/v1/shelters/:id/occupancy` — body `{ delta: number }`, adjusts
  `current_occupancy` (`shelter.manage`, scoped to the shelter's place)
- `GET  /api/v1/shelters/nearest?lng=&lat=&limit=` — nearest **open**
  shelters to a point, distance in meters. **No auth/RBAC** — public,
  citizen-facing.

## Business logic: occupancy auto full/open transition
`ShelterService.adjustOccupancy(id, delta, actorId)`:
1. Atomically applies `current_occupancy = GREATEST(0, current_occupancy + delta)`
   at the repository layer (never goes negative).
2. Reads the updated row. If `capacity` is set and `status !== 'closed'`:
   - `current_occupancy >= capacity` and not already `'full'` → transitions
     to `'full'`.
   - `current_occupancy < capacity` and currently `'full'` → transitions
     back to `'open'`.
   - A `'closed'` shelter is never auto-reopened by an occupancy change.
3. Audits `shelter.occupancy_changed` with `{ delta, currentOccupancy, status }`.

## Data
`status`: `open | full | closed` (default `open`, DB enum `shelter_status`).
`facilities`: free-form text array (e.g. `water`, `medical`, `electricity`,
`sanitation`). `capacity` / `current_occupancy`: integers, `current_occupancy`
defaults to 0 and is only ever mutated via the occupancy endpoint (direct
`PATCH` does not touch it). `name` (2-200 chars), `contact_phone` (optional),
`notes` (optional, free text).

## Permissions (packages/shared/src/constants/permissions.ts)
`shelter.create` / `.read` / `.manage` — already present in this worktree as
of commit `089b5e9`, along with the role grants below (not modified by this
module).

| Role | create | read | manage |
|---|---|---|---|
| super_admin | y (`*`) | y | y |
| national_agency | – | y | y |
| regional_coordinator | – | y | y |
| district_officer | y | y | y |
| field_worker | – | y | – |
| ngo_partner | – | y | – |
| community_moderator | – | y | – |

## Wiring needed (out of this module's scope — for the orchestrating session)
1. **`src/core/http/container.ts`**:
   ```ts
   import { ShelterService } from '../../modules/response/shelters/shelter.service';
   // in CoreServices:
   shelters: ShelterService;
   // in createCoreServices():
   shelters: new ShelterService(db, geography, audit),
   ```
2. **`src/core/http/register.ts`**:
   ```ts
   import { buildShelterRouter } from '../../modules/response/shelters/shelter.routes';
   // ...
   app.use('/api/v1/shelters', buildShelterRouter(services));
   ```
   (`buildShelterRouter` accepts `{ shelters, geography, rbac }`, which a full
   `CoreServices` object satisfies once item 1 is done.)
