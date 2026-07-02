# core/rbac

Geography-scoped role-based access control (spec 03 §3, ADR-0007). A user holds
one or more **grants** — a role over a place (or national). Access is allowed if
any grant both carries the permission and covers the target place.

## Files
- `rbac.ts` — pure, unit-tested decision logic: `can()`, `pathWithin()`, `roleHasPermission()`.
- `rbac.repository.ts` — loads a user's grants (`user_roles` ⋈ `places`).
- `rbac.service.ts` — DB-backed `can(userId, permission, targetPath)`.
- `rbac.middleware.ts` — Express `requirePermission()` factory (wired in Step 0.7).
- Catalog of permissions + role→permission map lives in `@nexus/shared` (`permissions.ts`).

## Model
- **Roles/permissions/role_permissions**: reference data (migration `0002_identity.sql`, seeded from `@nexus/shared`).
- **user_roles**: `(user_id, role_code, place_id?)` — `place_id` NULL = national scope.
- **Scope check**: `places.path` (ltree). `target within scope` ⇔ `target = scope OR target startsWith scope + '.'`.

## Usage
```ts
const rbac = new RbacService(db);
await rbac.can(userId, 'report.verify', 'gh.northern.tolon');   // scoped check
await rbac.can(userId, 'config.manage');                        // national action

// route guard (after Step 0.7 wiring)
router.post('/verify', authenticate, requirePermission(rbac, 'report.verify', reqToPlacePath), ctrl.verify);
```

## Compatibility
Legacy `authenticate` / `requireRole` (middleware/auth.js) keep working unchanged during
the transition. `requirePermission` is the new, geography-aware guard.

## Notes
- Legacy users are backfilled to national scope (`seed-rbac.ts`); precise geo-scoping of
  legacy accounts happens when district strings are resolved (Step 0.7).
- Add `@types/express` when the middleware is wired to real routes.
