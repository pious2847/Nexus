# N12 — Anticipatory action / forecast-based triggers

A **protocol** is a pre-agreed rule: if a hazard event of `hazard_type`
reaches `trigger_state` in `place_id` (or a descendant place), automatically
run `actions` — e.g. pre-alert community focal points, flag vulnerable
persons for evacuation priority, log a relief pre-positioning
recommendation. This is designed to fire when a hazard event transitions
state.

Schema: `src/db/migrations/0019_missing_persons_rumor_anticipatory.sql`
(`anticipatory_protocols`, `protocol_activations`).

## Files

- `anticipatory.repository.ts` — raw SQL (Drizzle `sql` tag) data access:
  protocol CRUD, the trigger-matching query (`findMatchingActiveProtocols`,
  event place must equal or be a descendant of the protocol's place), and
  the activation log (`insertActivation` catches Postgres `23505` — the
  unique `(protocol_id, hazard_event_id)` constraint — and returns `null`
  instead of throwing, so a fire-at-most-once race is a safe no-op).
- `anticipatory.service.ts` — `AnticipatoryService`: protocol CRUD +
  `checkAndActivate()`, the activation-execution engine. Every action type
  is executed and its result recorded into `protocol_activations.actions_taken`.
- `anticipatory.routes.ts` — `buildAnticipatoryRouter({ anticipatory, geography, rbac })`.
  Routes: `POST /protocols`, `GET /protocols?scope=&hazardType=&active=`,
  `GET /protocols/:id`, `PATCH /protocols/:id`, `GET /activations?scope=`.
  Permissions: `anticipatory.read` / `anticipatory.manage` (already defined
  in `packages/shared/src/constants/permissions.ts` as of commit d1ad2ac).

## Action types

1. **`notify_focal_points`** `{params: {message?: string}}` — fans out to
   every active community focal point covering the triggering hazard
   event's place (mirrors `AlertsService.publish()`'s focal-point fan-out
   in `alerts.service.ts` lines ~184-210: SMS to `contact_phone`, email to
   `contact_email`). Uses `params.message` if given, else:
   `"NEXUS ANTICIPATORY ACTION: ${protocol.name} triggered for ${hazardType} ${triggerState} in your area. Prepare now."`
   No-ops with a `{skipped: true, reason}` result if `focalPoints` wasn't
   injected.
2. **`flag_vulnerable_evacuation`** `{params: {}}` — queries
   `vulnerablePersons.listByScope(hazardEvent.placeId, {status: 'active'})`
   and records the count + ids. **This does not mutate the vulnerable-persons
   registry** — there's no evacuation-flag column. The point is surfacing the
   list to responders via the activation log for a human to act on. No-ops
   with a `{skipped: true, reason}` result if `vulnerablePersons` wasn't
   injected.
3. **`pre_position_relief`** `{params: {itemType?, note?}}` — **MVP: this is
   a logged recommendation for a human to action, not an automatic stock
   transfer.** Real inventory movement would require importing the relief
   module's repository, which is out of scope for this isolated build (same
   "deliberately scoped" honesty pattern as sirens/PA hardware in N6).
   Result: `{itemType, note, recorded: true}`.

Each action's result is appended to `actions_taken` as
`[{type, params, result}]` on the `protocol_activations` row.

## Wiring needed (orchestrator TODO — NOT done in this module)

This module only creates new files under `src/modules/anticipatory/`. It
does **not** edit `container.ts`, `register.ts`, or `hazards.service.ts`.
To integrate:

1. **`container.ts`** — add to `CoreServices`:
   ```ts
   anticipatory: AnticipatoryService;
   ```
   Construct it (constructor param order is
   `db, geography, audit?, focalPoints?, vulnerablePersons?, sendSms?, sendEmail?`):
   ```ts
   anticipatory: new AnticipatoryService(db, geography, audit, focalPoints, vulnerablePersons),
   ```
   (`focalPoints` is already constructed in `container.ts`; `vulnerablePersons`
   is constructed later in the same function — either reorder so `vulnerablePersons`
   exists before this line, or construct it earlier alongside `focalPoints`.)

2. **`register.ts`** — mount the router:
   ```ts
   app.use('/api/v1/anticipatory', buildAnticipatoryRouter({
     anticipatory: services.anticipatory,
     geography: services.geography,
     rbac: services.rbac,
   }));
   ```

3. **`hazards.service.ts`** — hook `checkAndActivate()` into the transition
   method (around line 123, `async transition(id, toState, actorId?, reason?)`,
   after the transition + audit record, using the freshly-reloaded event so
   `place_id`/`hazard_type` reflect the post-transition row):
   ```ts
   const updatedEvent = await repo.getEvent(this.db, id);
   if (updatedEvent?.place_id) {
     await this.anticipatory?.checkAndActivate({
       id: updatedEvent.id,
       hazardType: updatedEvent.hazard_type,
       placeId: updatedEvent.place_id,
       state: toState,
     });
   }
   return updatedEvent as HazardEvent;
   ```
   Note `hazard_events.place_id` is nullable in the schema — guard on it
   being set (as above) since `checkAndActivate` requires a concrete
   `placeId`. This makes `HazardService` need an optional
   `anticipatory?: AnticipatoryService` constructor param, same
   graceful-degrade pattern as everything else here — omitting it just
   means no anticipatory checks run, never a throw.

`checkAndActivate()` never throws for "nothing matched" or "already
activated" (only for genuine errors), so it's safe to call unconditionally
from the transition path once wired.

## Testing note

No DB-gated integration tests are included here (per build instructions —
the orchestrator verifies live, once, after integrating all three parallel
N-module builds, to avoid concurrent-agent DB pollution on the shared Neon
dev database). If you unit-test `checkAndActivate()`, inject fake
`sendSms`/`sendEmail`/`focalPoints`/`vulnerablePersons` stubs — never invoke
real SMS/email sending in a test.
