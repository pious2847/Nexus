# modules/missing

Missing persons & family reunification (spec 02 N3, Module N). Lets a
reporter (citizen, field worker, moderator, officer) register someone as
missing, and lets officers search for likely matches against two other
registries — N1 safety check-ins ("I'm Safe") and N4 vulnerable persons —
using fuzzy name matching, then record a confirmed match/resolution. Built in
parallel with N11 (rumor control) and N12 (anticipatory action), which share
migration 0019 but touch none of this module's tables.

Sensitive PII, same posture as `modules/vulnerable`:
- **Every list is geography-scoped** — `GET /` requires an explicit `scope`
  place (400 without it); there is deliberately no "list everyone
  nationally" method.
- **Matching is candidate discovery only, never automatic.** `GET /:id/matches`
  runs `pg_trgm` `similarity()` (threshold `> 0.3`) against
  `safety_checkins.subject_name` and `vulnerable_persons.full_name`, scoped to
  the missing-person record's own place subtree, and returns up to 10 ranked
  candidates from each source combined and sorted by score. A human with
  `missing.manage` confirms a match by `PATCH`-ing
  `matchedCheckinId`/`matchedVulnerablePersonId` — nothing here writes a match
  by itself.
- **No transition state machine.** `PATCH /:id` validates `status` is one of
  the DB enum's four members (`missing`, `found`, `reunified`, `closed`) —
  any officer can move a record between any of them (e.g. reopening a
  wrongly-closed report), unlike dispatch/hazard-event's forward-only state
  machines. Moving into a resolved status (`found`/`reunified`/`closed`)
  stamps `resolved_by`/`resolved_at` with the acting officer/now.
- **Every mutation audited** (`missing.reported`, `missing.status_changed`).

## Files
- `missing.status.ts` — pure helpers: `isValidMissingStatus`,
  `isResolvedMissingStatus`. No DB — unit tested in `missing.status.test.ts`.
- `missing.repository.ts` — SQL via Drizzle's `sql` tag (matches
  `vulnerable.repository.ts`/`shelter.repository.ts`'s style); geometry
  select-back via `ST_X`/`ST_Y` (mirrors `sos.repository.ts`); `listMissingByScope`
  and the two `findCandidate*` functions use the ltree subtree pattern
  `place_id IN (SELECT id FROM places WHERE path <@ (SELECT path FROM places WHERE id = $scopePlaceId))`.
- `missing.service.ts` — `MissingPersonsService`: report/getMissingPerson/
  missingPersonPlacePath/listByScope/findMatches/updateStatus/resolvePlace.
  Constructor `(db, geography, audit?)` — audits every create/update, skips
  silently if `audit` is undefined (matches `ShelterService`/
  `VulnerablePersonsService`).
- `missing.routes.ts` — `buildMissingPersonsRouter(...)`, intended mount:
  `/api/v1/missing-persons`.
- `missing.status.test.ts` — unit tests for the pure status helpers. No
  DB-gated integration tests written here; the orchestrating session verifies
  live, once, after integrating all three parallel N-modules (see task
  constraints — avoids concurrent-agent DB pollution on the shared Neon dev
  branch).

## Endpoints
- `POST /api/v1/missing-persons` — report a missing person (`missing.report`,
  scoped to the resolved place from `placeId` or `lng`/`lat`; the same
  `lng`/`lat` also become the record's `last_seen_location`)
- `GET  /api/v1/missing-persons?scope=<placeId>` — list a district/region's
  board (`missing.read`; optional `&status=`)
- `GET  /api/v1/missing-persons/:id` — detail (`missing.read`, scoped to the
  record's place)
- `GET  /api/v1/missing-persons/:id/matches` — ranked candidate matches from
  safety check-ins + vulnerable-persons registry (`missing.read`, same
  scoping)
- `PATCH /api/v1/missing-persons/:id` — update `status`/`matchedCheckinId`/
  `matchedVulnerablePersonId`/`notes` (`missing.manage`, same scoping)

## Data
`status`: `missing | found | reunified | closed` (default `missing`, DB enum
`missing_person_status`). `age_estimate` is free text ("8", "elderly",
"40s") since exact ages are often unknown at report time. `full_name` has a
`pg_trgm` GIN trigram index (`missing_persons_name_trgm`) backing the fuzzy
match. `reporter_phone` is required; `reporter_id` is the authenticated
actor who filed the report (nullable at the DB level, but every route here
requires auth so it's always populated in practice — unlike shelters, there
is no public/unauthenticated route on this router).

## Permissions (packages/shared/src/constants/permissions.ts)
`missing.report` / `.read` / `.manage` — already present in this worktree as
of commit `d1ad2ac`, along with the role grants below (not modified by this
module).

| Role | report | read | manage |
|---|---|---|---|
| super_admin | y (`*`) | y | y |
| national_agency | y | y | y |
| regional_coordinator | y | y | y |
| district_officer | y | y | y |
| field_worker | y | y | – |
| community_moderator | y | y | – |
| citizen | y | – | – |

(See `packages/shared/src/constants/permissions.ts` for the exact
per-role grant list — this table is illustrative, not authoritative.)

## Wiring needed (out of this module's scope — for the orchestrating session)
1. **`src/core/http/container.ts`**:
   ```ts
   import { MissingPersonsService } from '../../modules/missing/missing.service';
   // in CoreServices:
   missingPersons: MissingPersonsService;
   // in createCoreServices():
   missingPersons: new MissingPersonsService(db, geography, audit),
   ```
2. **`src/core/http/register.ts`**:
   ```ts
   import { buildMissingPersonsRouter } from '../../modules/missing/missing.routes';
   // ...
   app.use('/api/v1/missing-persons', buildMissingPersonsRouter(services));
   ```
   (`buildMissingPersonsRouter` accepts `{ missingPersons, geography, rbac }`,
   which a full `CoreServices` object satisfies once item 1 is done.)
