# modules/admin/users

Admin user & role management (Module A/L gap). The RBAC v2 system (built in
Phase 0 — `src/core/rbac/`) has a full `can()`/permission-check engine, but
until this module there was no HTTP surface to actually manage who holds
what role: no way to list/activate/suspend a user account, or to
grant/revoke a geography-scoped role grant. Reuses two permissions that
already existed in `packages/shared/src/constants/permissions.ts` with no
implementing routes anywhere in the codebase — `user.manage` ("Manage user
accounts") and `role.assign` ("Assign roles to users") — both already
granted to `super_admin` via `'*'`. **No new permissions were added.**

Independent of the N15 damage-assessment and N16 facility-capacity modules
built in parallel this round (different directories, no overlap). Per this
module's task scope, only new files under this directory were created —
`container.ts`, `register.ts`, `permissions.ts`, and the existing
`modules/admin/admin.routes.ts` were **not** touched; wiring is left to the
orchestrating session (see "Wiring needed" below).

## Design notes
- **`users.role` is legacy** — a single-role text column from before RBAC
  v2. It is never read or written by this module. The real source of truth
  for who holds what role is the `user_roles` grant table (many-to-many: a
  user can hold multiple role+place grants at once), exactly as
  `core/rbac/rbac.repository.ts`'s `getUserGrants()` reads it for permission
  checks.
- **`users.status` is the real status field** (`active` / `suspended`,
  default `active`) — not `is_active`, which is a separate legacy boolean
  left untouched here.
- **User/role administration is platform-wide, not geo-scoped.** Every route
  calls `requirePermission(rbac, perm)` with no third (`resolveTargetPath`)
  argument, so the RBAC check runs against `targetPath = null` — only a
  national-level grant of `user.manage` / `role.assign` passes, regardless
  of the target user's own role scopes.
- **`user_roles` has a real unique index** on
  `(user_id, role_code, COALESCE(place_id, '000...0'))`
  (`0002_identity.sql`). `admin-users.repository.ts`'s `grantRole` pre-checks
  for an identical existing grant and returns it instead of attempting a
  duplicate insert, so granting the same role+scope twice is idempotent
  rather than a raw constraint-violation error.
- **Every mutation is audited** (`admin.user.status_changed`,
  `admin.role.granted`, `admin.role.revoked`), no-op if `audit` is
  undefined — matches the optional-audit pattern used throughout this
  codebase (e.g. `shelter.service.ts`).

## Files
- `admin-users.repository.ts` — raw SQL via Drizzle's `sql` tag.
  `listUsers`/`getUser` aggregate each user's current role grants as a JSON
  array subquery (`roleCode`, `placeId`, `placeName`). `grantRole` does the
  duplicate pre-check described above; `revokeRole` returns `null` if
  nothing was deleted so the service/route can 404.
- `admin-users.service.ts` — `AdminUsersService(db, audit?)`:
  `listUsers`/`getUser`/`updateStatus`/`listUserRoles`/`grantRole`/
  `revokeRole`. `revokeRole` fetches the grant first (via the repository's
  `getRoleGrant`) purely so the audit entry keeps user/role context after
  the row is gone.
- `admin-users.routes.ts` — `buildAdminUsersRouter({ adminUsers, rbac })`,
  deps typed as `Pick<CoreServices, 'rbac'> & { adminUsers: AdminUsersService }`
  so this file type-checks standalone before the orchestrator wires it in.
  Intended mount: `/api/v1/admin/users` (as its OWN router, mounted
  alongside — not merged into — the existing `modules/admin/admin.routes.ts`,
  which stays untouched).

## Endpoints
All routes require authentication (`router.use(authenticate)`) plus the
noted permission, checked nationally (no geo-scope):
- `GET /api/v1/admin/users?status=&search=` (`user.manage`) — list users
  (max 200, newest first). `search` does an `ILIKE` match against
  name/email/phone.
- `GET /api/v1/admin/users/:id` (`user.manage`) — single user detail. 404 if
  not found.
- `PATCH /api/v1/admin/users/:id/status` (`user.manage`) — body
  `{ status: 'active' | 'suspended' }`.
- `GET /api/v1/admin/users/:id/roles` (`user.manage`) — list a user's
  current role grants.
- `POST /api/v1/admin/users/:id/roles` (`role.assign`) — body
  `{ roleCode: string, placeId?: string | null }`. `roleCode` is validated
  against the known `Role` enum from `@nexus/shared` (not an arbitrary
  string). `placeId` omitted/null = national-scoped grant.
- `DELETE /api/v1/admin/users/:id/roles/:roleGrantId` (`role.assign`) —
  revoke a role grant. 404 if the grant didn't exist.

## Data
`user_roles` columns: `id`, `user_id`, `role_code` (FK `roles.code`, a
`Role` value from `packages/shared/src/constants/roles.ts`), `place_id`
(nullable FK `places` — `NULL` = national scope, non-null = scoped to that
place's subtree), `granted_by`, `granted_at`.

## Not built / left for the orchestrating session
This task intentionally excludes DB-gated integration tests and live
verification against the shared dev database — this module can suspend or
otherwise modify real user accounts (including the seed admin account), so
live verification is deliberately deferred to a single orchestrator pass
after all parallel modules for this round are integrated, rather than each
worktree agent hitting the shared DB independently.

## Wiring needed (out of this module's scope — for the orchestrating session)
1. **`src/core/http/container.ts`**:
   ```ts
   import { AdminUsersService } from '../../modules/admin/users/admin-users.service';
   // in CoreServices:
   adminUsers: AdminUsersService;
   // in createCoreServices():
   adminUsers: new AdminUsersService(db, audit),
   ```
2. **`src/core/http/register.ts`**:
   ```ts
   import { buildAdminUsersRouter } from '../../modules/admin/users/admin-users.routes';
   // ...
   app.use('/api/v1/admin/users', buildAdminUsersRouter(services));
   ```
   (`buildAdminUsersRouter` accepts `{ adminUsers, rbac }`, which a full
   `CoreServices` object satisfies once item 1 is done. This mounts as its
   own router under the existing `/api/v1/admin` prefix pattern, alongside
   — not merged into — `admin.routes.ts`.)
