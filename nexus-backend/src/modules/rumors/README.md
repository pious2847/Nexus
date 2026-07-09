# modules/rumors

N11 — Rumor & misinformation control (Module N — Life-Safety & Social
Trust). Two independent-but-related verticals sharing one module directory:

1. **Rumor intake & review** (`rumor.*`) — citizens/field workers report a
   rumor circulating during a hazard event; officers review it and mark it
   `confirmed_false` / `confirmed_true` / `clarified`.
2. **Official myth-vs-fact clarification** (`mythfact.*`) — an officer
   publishes a short, authoritative correction (optionally linked to the
   rumor report that prompted it) that fans out to the N6 community
   focal-point network, the same last-mile channel `AlertsService.publish()`
   uses, plus a public feed citizens can read with no auth.

Built in parallel with N3 (missing persons) and N12 (anticipatory action) —
independent tables from the same migration (`0019`), independent files
here, no shared code touched.

## Files
- `rumor.repository.ts` — SQL via Drizzle's `sql` tag (mirrors
  `shelter.repository.ts`'s style). `place_id` on `rumor_reports` is
  **nullable** (a rumor can be phoned in with no resolvable location);
  `listRumorsByScope`'s `place_id IN (SELECT id FROM places WHERE path <@ ...)`
  naturally excludes NULL-place rows (SQL `IN` never matches NULL), and
  `rumorPlacePath` returns `null` for them via an inner join that simply
  won't match — `rbac.can(userId, perm, null)` then requires a
  **national-scope** grant to act on that rumor.
- `mythfact.repository.ts` — same style. `listMythFactsByScope`'s
  `scopePlaceId` is **optional** (this is a public feed): given, it scopes
  to a subtree the same NULL-excluding way; omitted, it returns the most
  recent `limit` entries nationwide regardless of place.
- `rumor.service.ts` — `RumorService`. Constructor:
  `(db: Db, geography: GeographyService, audit?: AuditRecorder)`.
  Methods: `report(input, reporterId)`, `getRumor(id)`,
  `listByScope(scopePlaceId, filters)`, `review(id, patch, actorId)`
  (sets `reviewedBy`/`reviewedAt`), `rumorPlacePath(id)`,
  `resolvePlace(lng?, lat?)` (mirrors `ShelterService.resolvePlace`, used by
  the route layer to turn optional lng/lat into a placeId). Audits
  `rumor.reported` / `rumor.reviewed`; no-ops if `audit` is omitted.
- `mythfact.service.ts` — `MythFactService`. Constructor (positional,
  **exact order matters**):
  ```ts
  constructor(
    db: Db,
    geography: GeographyService,
    focalPoints?: FocalPointService,          // optional, not defaulted — omit to skip fan-out
    sendSms: SmsSender = defaultSendSms,       // from ../../integrations/arkesel
    sendEmail: EmailSender = defaultSendEmail, // from ../../integrations/email
  )
  ```
  `publish(input, publishedBy)` inserts the `myth_fact_entries` row, and —
  if `input.placeId` is given — resolves its ltree path via
  `geography.getById()` and fans out `formatMythFactScript({myth, fact})`
  to every active focal point covering that scope (SMS to `contact_phone`,
  email to `contact_email`), exactly mirroring `AlertsService.publish()`'s
  focal-point block in `../alerts/alerts.service.ts` (lines ~184-210).
  Records the result as `channels_notified: { focalPointsNotified: N }` via
  `setChannelsNotified`. Also: `listPublic(scopePlaceId?, limit?)`,
  `getMythFact(id)`, and `resolvePlacePath(placeId)` (used by the route
  layer's RBAC scope check — see below).
- `rumor.routes.ts` — `buildRumorRouter({ rumors, geography, rbac })`,
  intended mount `/api/v1/rumors`. All routes require authentication.
  `POST /` resolves the target place from optional `placeId`/`lng`/`lat`
  (mirrors `shelter.routes.ts`'s `resolveTargetPlace`, but a **null**
  result is accepted here — an unscoped report still goes through).
  `GET /?scope=&status=` — 400 if `scope` missing. `GET /:id` and
  `PATCH /:id` scope via `rumorPlacePath` (null path → national-only).
- `mythfact.routes.ts` — `buildMythFactRouter({ mythFacts, rbac })`,
  intended mount `/api/v1/myth-facts`. `GET /?scope=&limit=` and
  `GET /:id` are **public** — no `authenticate`, no RBAC — registered as
  plain routes (this router has no other public/private split to manage,
  unlike `shelter.routes.ts`'s single `/nearest` exception, so `authenticate`
  is applied only to the one route that needs it: `POST /`, which also
  requires `mythfact.publish` scoped via `mythFacts.resolvePlacePath(placeId)`
  when a `placeId` is given, else a national-scope check).

No standalone unit tests: `formatMythFactScript` is a pure one-liner not
worth isolating, and `publish()`'s fan-out branch is exercised implicitly
via the same shape `alerts.service.ts` already validates — DB-gated
integration testing is left to the orchestrating session per the task
constraints (this module never invokes real SMS/email in any test, since
none were written here).

## Data
`rumor_reports.status`: `reported | reviewing | confirmed_false |
confirmed_true | clarified` (DB enum `rumor_status`, default `reported`).
`rumor_reports.source`: free text (`radio` / `social_media` /
`word_of_mouth` / `other` are the expected values, not DB-enforced).
`myth_fact_entries.channels_notified`: JSONB fan-out summary, same shape
convention as `alerts` table's delivery counters.

## Permissions (packages/shared/src/constants/permissions.ts)
Already present as of commit `d1ad2ac`, not modified by this module:
`rumor.report` (citizens+), `rumor.read`, `rumor.manage` (officers+),
`mythfact.publish` (officers+).

## Wiring needed (out of this module's scope — for the orchestrating session)

1. **`src/core/http/container.ts`**:
   ```ts
   import { RumorService } from '../../modules/rumors/rumor.service';
   import { MythFactService } from '../../modules/rumors/mythfact.service';
   // in CoreServices:
   rumors: RumorService;
   mythFacts: MythFactService;
   // in createCoreServices(), after geography/audit/focalPoints are constructed:
   rumors: new RumorService(db, geography, audit),
   mythFacts: new MythFactService(db, geography, focalPoints, undefined, undefined),
   ```
   (`focalPoints` here is the same `FocalPointService` instance already
   constructed for `alerts` — reuse it, don't build a second one.)

2. **`src/core/http/register.ts`**:
   ```ts
   import { buildRumorRouter } from '../../modules/rumors/rumor.routes';
   import { buildMythFactRouter } from '../../modules/rumors/mythfact.routes';
   // ...
   app.use('/api/v1/rumors', buildRumorRouter(services));
   app.use('/api/v1/myth-facts', buildMythFactRouter(services));
   ```
   (`buildRumorRouter` accepts `{ rumors, geography, rbac }`;
   `buildMythFactRouter` accepts `{ mythFacts, rbac }` — both satisfied by
   a full `CoreServices` object once item 1 is done.)
