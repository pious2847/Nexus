# modules/response/dispatch

Incident dispatch/tasking (Module M — Emergency Response & Coordination, "M3"
in the migration's comments). Coordinators raise a `dispatch_task` (rescue,
assessment, distribution, repair, other), assign it to a user, and track it
through a forward-moving lifecycle to completion. Every status change is
recorded in `dispatch_task_events` — the raw material for the response-timeline
/ after-action aggregation endpoint the orchestrator builds separately.

This module does **not** touch `modules/response/shelters/` or
`modules/response/relief/` (a parallel agent's territory) — dispatch tasks
reference neither table directly, though the orchestrator may later use
`dispatch_tasks.source_type`/`source_id` to link an SOS alert to an
auto-created task (also not built here; see "Known gaps").

## Files
- `dispatch.state.ts` — the `DispatchStatus` state machine. Pure, unit-tested,
  structurally identical to `modules/hazards/hazards.state.ts`:
  `ALLOWED_TRANSITIONS`, `canTransition`, `assertTransition`, `isTerminal`.
- `dispatch.state.test.ts` — unit tests (mirrors `hazards.state.test.ts`'s coverage).
- `dispatch.repository.ts` — SQL via Drizzle's `sql` tag. `listByScope` uses
  ltree subtree (`path <@`), same pattern as the health-facility / vulnerable-
  persons registries. `getTaskPlacePath` can return `null` (place_id is
  nullable on this table) — see "Nullable place" below.
- `dispatch.service.ts` — `DispatchService`: `createTask`/`getTask`/
  `taskPlacePath`/`listByScope`/`taskEvents`/`transition`/`assign`. Direct
  analog of `hazards.service.ts`'s `raiseEvent`/`transition`: every state
  change is validated against the state machine, recorded in
  `dispatch_task_events`, and audited.
- `dispatch.routes.ts` — `buildDispatchRouter({ dispatch, geography, rbac })`,
  intended mount: `/api/v1/dispatch`.

## Lifecycle

```
open ──▶ assigned ──▶ in_progress ──▶ done
  │           │              │
  └───────────┴──────────────┴──▶ cancelled
```

Forward-only; `cancelled` is reachable from any non-terminal state. `done` and
`cancelled` are terminal. Transitioning to `done` auto-sets `completed_at`.

## `assign()` design choice

`DispatchService.assign(id, assignedTo, actorId)` sets `assigned_to` AND
transitions `open → assigned` in one call **only when the task is still
`open`** (the common "dispatch a fresh task" case). If the task is already
past `open` (e.g. `assigned` or `in_progress`), `assign()` just updates
`assigned_to` — a reassignment — without forcing a status transition, since
e.g. `in_progress → assigned` isn't a legal move in the forward-only state
machine and would need `dispatch.service.ts`'s `transition()` (which enforces
`assertTransition`) to bypass on purpose. This is documented inline in
`dispatch.service.ts`.

## Endpoints
- `POST /api/v1/dispatch` — create (`dispatch.create`, scoped to `placeId` if given)
- `GET  /api/v1/dispatch?scope=<placeId>` — list (`dispatch.read`; `&status=`/`&taskType=`/`&hazardEventId=` filters)
- `GET  /api/v1/dispatch/:id` — detail (`dispatch.read`)
- `GET  /api/v1/dispatch/:id/events` — status-change history (`dispatch.read`)
- `POST /api/v1/dispatch/:id/assign` — body `{ assignedTo }` (`dispatch.manage`)
- `POST /api/v1/dispatch/:id/transition` — body `{ status, note? }` (`dispatch.manage`).
  A thrown transition error (illegal move) is caught and returned as
  `400 { success: false, message }`, not a 500 — same try/catch shape as
  `hazards.routes.ts`'s transition endpoint (that route uses 409 for its own
  domain; this one returns 400 per this module's task spec).

## Nullable place / RBAC fallback

`dispatch_tasks.place_id` is nullable (a task can be raised before a place is
resolved, e.g. from a bare SOS ping). `getTaskPlacePath` returns `null` in
that case. `requirePermission`'s `resolveTargetPath` then passes `null` as the
target path, and per `core/rbac/rbac.ts`'s `can()`, a `null` target path is
only satisfied by a **national-scoped grant** (`scopePath: null`) — a
regionally/district-scoped grant cannot act on a task with no resolved place.
This mirrors how `hazards.repository.ts`'s `getEventPlacePath` /
`alerts.repository.ts`'s nullable-place handling behave elsewhere in this
codebase; no new fallback logic was invented here.

## Testing
`dispatch.state.test.ts` covers the state machine (forward path, cancel-from-
any-non-terminal, illegal/backward/self transitions, terminal-state checks).
No DB-gated integration test was written for this module per the task's
instruction — the orchestrator runs live-DB verification separately.

## Known gaps / wiring needed (out of this module's scope)
1. **`src/core/http/container.ts`**:
   ```ts
   import { DispatchService } from '../../modules/response/dispatch/dispatch.service';
   // in CoreServices:
   dispatch: DispatchService;
   // in createCoreServices():
   dispatch: new DispatchService(db, audit),
   ```
2. **`src/core/http/register.ts`**:
   ```ts
   import { buildDispatchRouter } from '../../modules/response/dispatch/dispatch.routes';
   // ...
   app.use('/api/v1/dispatch', buildDispatchRouter(services));
   ```
   (`buildDispatchRouter` accepts `{ dispatch, geography, rbac }`, which a full
   `CoreServices` object satisfies once item 1 is done.)
3. **SOS → auto-dispatch wiring** (explicitly the orchestrator's job, not
   built here): when an SOS alert is raised, call
   `dispatch.createTask({ placeId, lng, lat, taskType: 'rescue', sourceType: 'sos', sourceId: sosAlert.id }, actorId)`.
   `source_type`/`source_id` on `dispatch_tasks` exist precisely for this link.
4. **Response-timeline / after-action aggregation** (also the orchestrator's
   job): `dispatch.taskEvents(id)` / `dispatch.repository.ts`'s
   `listTaskEvents` already expose the full status-change history needed to
   build that endpoint; no changes needed here to support it.
