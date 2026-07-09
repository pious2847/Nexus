# modules/response/volunteers

Volunteer & response-asset coordination (Module M — Emergency Response &
Coordination, "M4" in the migration's comments). Two independent registries
that both point at `dispatch_tasks` (via `assigned_task`) so an incident
coordinator can see who/what is deployed where:

- **Volunteers** — people, with `skills` (array) and `availability`
  (available/unavailable/deployed).
- **Response assets** — vehicles/boats/equipment, with `status`
  (available/deployed/maintenance).

Does **not** touch `modules/response/shelters/` or `modules/response/relief/`
(a parallel agent's territory) or `modules/response/dispatch/`'s own files
(a sibling module built by this same agent — `volunteer.routes.ts` imports
`DispatchService`'s type only, to resolve a task's place for `GET /match`).

## Files
- `volunteer.repository.ts` — SQL via Drizzle's `sql` tag. `listByScope` uses
  ltree subtree (`path <@`); skill filtering uses array-contains
  (`skills @> ARRAY[$skill]::text[]`). `findAvailableNear` is the proximity+
  skill match query (bidirectional ltree, same shape as
  `alerts.repository.ts`'s `findSubscribers`). Array writes go through a local
  `textArray()` helper (mirrors `core/notifications/notifications.repository.ts`'s
  helper of the same name) because Drizzle expands a bare JS array param into
  a tuple `($1,$2,...)`, which can't bind to a `text[]` column.
- `asset.repository.ts` — same CRUD-registry shape, no array columns.
- `volunteer.service.ts` — `VolunteerService`: `register`/`getVolunteer`/
  `volunteerPlacePath`/`listByScope`/`update`/`assignToTask`/`matchForTask`/
  `resolvePlace`. Every mutation audited.
- `asset.service.ts` — `AssetService`: `register`/`getAsset`/`assetPlacePath`/
  `listByScope`/`update`/`assignToTask`. Every mutation audited.
- `volunteer.routes.ts` — `buildVolunteerRouter({ volunteers, dispatch, geography, rbac })`,
  intended mount: `/api/v1/volunteers`.
- `asset.routes.ts` — `buildAssetRouter({ assets, geography, rbac })`,
  intended mount: `/api/v1/response-assets`.

## Matching volunteers to a task (`GET /match`)

`GET /api/v1/volunteers/match?taskId=<uuid>&skill=<optional>` resolves the
task's place via `dispatch.taskPlacePath(taskId)`, then calls
`VolunteerService.matchForTask(placePath, skill, limit)`, which queries
`volunteer.repository.ts`'s `findAvailableNear`: `availability = 'available'`
AND the volunteer's base place shares lineage with the task's place in either
direction (`p.path <@ taskPath OR taskPath <@ p.path` — e.g. a task in a
specific community also matches volunteers registered at the district level,
and vice versa), optionally narrowed by `skill` (array-contains). Returns 404
if the task has no resolvable place (mirrors dispatch's nullable-place
handling — see `modules/response/dispatch/README.md`).

The `/match` route is registered **before** `/:id` in `volunteer.routes.ts` so
Express doesn't capture the literal string `match` as an `:id` param.

## Endpoints

### Volunteers (`/api/v1/volunteers`)
- `POST /` — register (`volunteer.create`, scoped to `placeId` or resolved lng/lat)
- `GET  /?scope=<placeId>` — list (`volunteer.read`; `&availability=`/`&skill=` filters)
- `GET  /match?taskId=&skill=` — proximity+skill match (`volunteer.read`)
- `GET  /:id` — detail (`volunteer.read`)
- `PATCH /:id` — partial update: name/phone/skills/availability (`volunteer.manage`)
- `POST /:id/assign` — body `{ taskId }`; sets `assigned_task` + `availability: 'deployed'` (`volunteer.manage`)

### Response assets (`/api/v1/response-assets`)
- `POST /` — register (`asset.manage` — no separate create permission, per spec)
- `GET  /?scope=<placeId>` — list (`asset.read`; `&status=`/`&assetType=` filters)
- `GET  /:id` — detail (`asset.read`)
- `PATCH /:id` — partial update: name/assetType/status/notes (`asset.manage`)
- `POST /:id/assign` — body `{ taskId }`; sets `assigned_task` + `status: 'deployed'` (`asset.manage`)

## Data
`skills`: free-form text array (e.g. `['first_aid', 'boat_operator', 'swiftwater_rescue']`).
`availability`: `available | unavailable | deployed` (default `available`).
`asset_type`: `vehicle | boat | equipment | other`.
`status` (assets): `available | deployed | maintenance` (default `available`).

## Permissions (already present in packages/shared/src/constants/permissions.ts)
`volunteer.create` / `.read` / `.manage`; `asset.manage` / `.read` (single
combined manage permission for register+update, matching e.g.
`sanitation.manage`). Role grants were already wired by the schema/RBAC
foundation commit — this module did not touch `permissions.ts`.

## Testing
This module is thin CRUD plus one non-trivial query (`findAvailableNear`'s
bidirectional ltree match), which is exercised indirectly through
`VolunteerService.matchForTask` — no pure/unit-testable logic beyond that
(unlike dispatch's state machine), so per the task spec no unit tests were
forced here. No DB-gated integration test was written — the orchestrator runs
live-DB verification separately to avoid concurrent-write conflicts with the
parallel shelters/relief module's own DB tests.

## Known gaps / wiring needed (out of this module's scope)
1. **`src/core/http/container.ts`**:
   ```ts
   import { VolunteerService } from '../../modules/response/volunteers/volunteer.service';
   import { AssetService } from '../../modules/response/volunteers/asset.service';
   // in CoreServices:
   volunteers: VolunteerService;
   assets: AssetService;
   // in createCoreServices():
   volunteers: new VolunteerService(db, geography, audit),
   assets: new AssetService(db, audit),
   ```
2. **`src/core/http/register.ts`**:
   ```ts
   import { buildVolunteerRouter } from '../../modules/response/volunteers/volunteer.routes';
   import { buildAssetRouter } from '../../modules/response/volunteers/asset.routes';
   // ...
   app.use('/api/v1/volunteers', buildVolunteerRouter(services));
   app.use('/api/v1/response-assets', buildAssetRouter(services));
   ```
   (Both builders accept a subset of `CoreServices` plus this module's own
   services — `buildVolunteerRouter` additionally needs `dispatch`, so mount
   it only after `container.ts` has both `dispatch` and `volunteers`/`assets`
   wired in; a full `CoreServices` object satisfies all three routers'
   dependency types structurally once item 1 and dispatch's own container
   wiring are both done.)
