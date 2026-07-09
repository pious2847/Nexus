# modules/response/relief

Relief inventory — stock levels and distributions (Module M — Emergency
Response & Coordination, sub-module M2). Tracks what relief supplies (food,
water, tents, medical kits, blankets, ...) exist where, and records who they
were distributed to during a hazard response. Independent of the
dispatch/tasking and volunteer/asset coordination modules built in parallel
under `modules/response/dispatch/` and `modules/response/volunteers/` (not
touched here).

Unlike the shelter and health-facility registries, this is **operational**
data, not a public directory — there's no citizen-facing read endpoint.
Design choices reflect that:
- **A single `relief.manage` covers both create and update** — recording new
  stock and adjusting/distributing existing stock are both "operational"
  actions performed by the same set of roles; there's no separate
  `relief.create`.
- **NGOs are a first-class stakeholder** — `ngo_partner` gets
  `relief.read` + `relief.manage` even though they only get `shelter.read`
  (NGOs manage relief inventory but don't register shelters, per the spec's
  role-grant intent).
- **Distributions decrement stock atomically at the repository layer** —
  `insertDistribution` always writes the distribution row and decrements
  `relief_stocks.quantity` in the same function call, so callers can't do
  one without the other. This is two sequential queries, not a DB
  transaction — see "Known convention" below.
- **Insufficient-stock is a guarded business rule**, checked in the service
  layer *before* the repository call, not left to a DB constraint.
- **Every mutation audited** (`relief.stock_recorded`, `relief.stock_adjusted`,
  `relief.distributed`).

## Files
- `relief.repository.ts` — SQL via Drizzle's `sql` tag (matches
  `shelter.repository.ts`'s style); `listByScope` uses ltree subtree
  (`path <@`); `lowStockOnly` filters to `quantity <= low_stock_threshold`.
- `relief.service.ts` — `ReliefService`: recordStock/getStock/stockPlacePath/
  listByScope/adjustStock/distribute/listDistributions. No `GeographyService`
  dependency — stock is always tied to an existing `place_id`/`shelter_id`,
  never resolved from raw coordinates inside the service.
- `relief.routes.ts` — `buildReliefRouter(...)`, intended mount:
  `/api/v1/relief`. Takes `geography` as a route-layer dependency solely to
  resolve `lng`/`lat` → `placeId` on `POST /` (mirrors the
  `resolveTargetPlace` pattern from `shelter.routes.ts` /
  `health-facility.routes.ts`).
- No standalone unit tests: thin CRUD plus one guard clause
  (insufficient-stock), exercised directly inside `distribute` rather than
  as an isolable pure function — same call as the `health-facility` /
  `shelters` precedent. DB-gated integration testing is left to the
  orchestrating session (see task constraints).

## Endpoints
- `POST /api/v1/relief` — record a stock line (`relief.manage`, scoped to
  the resolved place from `placeId` or `lng`/`lat`)
- `GET  /api/v1/relief?scope=<placeId>` — list a district/region's relief
  inventory (`relief.read`; `&itemType=`/`&lowStockOnly=true` filters)
- `GET  /api/v1/relief/:id` — detail (`relief.read`, scoped to the record's
  place)
- `PATCH /api/v1/relief/:id/adjust` — body `{ delta: number }`, adjusts
  `quantity` (`relief.manage`, scoped to the record's place)
- `POST /api/v1/relief/:id/distribute` — body
  `{ quantity, recipientDesc?, hazardEventId? }`, records a distribution and
  decrements stock (`relief.manage`). Returns **400** (not 500) if
  `quantity` exceeds available stock.
- `GET  /api/v1/relief/:id/distributions` — distribution history for a stock
  record (`relief.read`)

## Business logic: insufficient-stock guard
`ReliefService.distribute(stockId, input, actorId)`:
1. Loads the stock row; throws `Error('Relief stock record not found')` if
   missing (→ 404 at the route layer).
2. Throws `Error('Distribution quantity must be positive')` if
   `quantity <= 0` (defense-in-depth — Zod's `.positive()` already blocks
   this at the route layer, so this branch is effectively unreachable via
   the HTTP API today).
3. Throws `Error('Insufficient stock: requested X, available Y')` if
   `quantity > stock.quantity` (→ 400 at the route layer — the route matches
   on whether the message contains "not found" to pick 404 vs 400).
4. Only after all three checks pass does it call `repo.insertDistribution`,
   which inserts the distribution row and decrements `relief_stocks.quantity`
   by the same amount as a second query.
5. Audits `relief.distributed` with `{ quantity, recipientDesc }`.

## Known convention: no explicit DB transaction
`insertDistribution` does the insert-then-decrement as two sequential
`db.execute` calls, not wrapped in `BEGIN`/`COMMIT`. This matches the
codebase's established pattern for multi-step writes — see
`hazards.service.ts`'s `raiseEvent`, which does a sequential insert-event +
insert-transition without a transaction wrapper. The service-layer
insufficient-stock check happens *before* either write, so the only race is
a rare concurrent double-distribution transiently pushing quantity below
zero, which the repository's `GREATEST(0, ...)` clamp absorbs (it will never
go negative, but two concurrent distributions could both "succeed" against
a now-stale read). If this module later gets a transaction helper, this is
the place to add `SELECT ... FOR UPDATE` or a transaction wrapper.

## Data
`item_type`: free text, but the route layer's Zod schema constrains
`POST /` to `food | water | tents | medical_kits | blankets | other`.
`quantity` / `low_stock_threshold`: non-negative integers. `unit`: free text,
default `'units'`. `shelter_id`: optional — stock can exist at a place
without being tied to a specific shelter (e.g. a district warehouse).

## Permissions (packages/shared/src/constants/permissions.ts)
`relief.read` / `.manage` — already present in this worktree as of commit
`089b5e9`, along with the role grants below (not modified by this module).

| Role | read | manage |
|---|---|---|
| super_admin | y (`*`) | y |
| national_agency | y | y |
| regional_coordinator | y | y |
| district_officer | y | y |
| ngo_partner | y | y |

(`field_worker` and `community_moderator` have no `relief.*` grants.)

## Wiring needed (out of this module's scope — for the orchestrating session)
1. **`src/core/http/container.ts`**:
   ```ts
   import { ReliefService } from '../../modules/response/relief/relief.service';
   // in CoreServices:
   relief: ReliefService;
   // in createCoreServices():
   relief: new ReliefService(db, audit),
   ```
2. **`src/core/http/register.ts`**:
   ```ts
   import { buildReliefRouter } from '../../modules/response/relief/relief.routes';
   // ...
   app.use('/api/v1/relief', buildReliefRouter(services));
   ```
   (`buildReliefRouter` accepts `{ relief, geography, rbac }`, which a full
   `CoreServices` object satisfies once item 1 is done.)
