/**
 * Pure RBAC decision logic — no DB, no framework, fully unit-testable.
 * A user holds one or more geography-scoped grants; access is allowed if ANY
 * grant both carries the permission and covers the target place (spec 03 §3).
 */
import { ROLE_PERMISSIONS, type Permission, type Role } from '@nexus/shared';

export interface Grant {
  role: Role;
  /** ltree path of the scope, or null for national (applies everywhere). */
  scopePath: string | null;
}

/** Does a role include a permission (respecting the `'*'` super-admin wildcard)? */
export function roleHasPermission(role: Role, permission: Permission): boolean {
  const perms = ROLE_PERMISSIONS[role] ?? [];
  return perms.includes('*') || perms.includes(permission);
}

/** ltree `<@`: is `target` at or below `scope`? (e.g. gh.northern.tolon within gh.northern) */
export function pathWithin(target: string, scope: string): boolean {
  return target === scope || target.startsWith(`${scope}.`);
}

/**
 * Can these grants perform `permission` on the place at `targetPath`?
 * - National grants (scopePath null) apply everywhere.
 * - A scoped grant applies only when targetPath is within its scope.
 * - targetPath null means "no specific place" → satisfied only by national grants.
 */
export function can(grants: Grant[], permission: Permission, targetPath: string | null): boolean {
  for (const g of grants) {
    if (!roleHasPermission(g.role, permission)) continue;
    if (g.scopePath === null) return true;
    if (targetPath !== null && pathWithin(targetPath, g.scopePath)) return true;
  }
  return false;
}
