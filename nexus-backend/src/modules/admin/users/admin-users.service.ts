/**
 * Admin user & role management service (Module A/L gap). The RBAC v2 `can()`
 * engine (built in Phase 0) had a full permission-check pipeline but no HTTP
 * surface to actually manage who holds what role — this closes that gap:
 * list/activate/suspend user accounts, and grant/revoke geography-scoped
 * role grants (`user_roles` rows). Every mutation is audited (no-op if
 * `audit` is undefined), matching the optional-audit pattern used throughout
 * this codebase (e.g. shelter.service.ts).
 */
import type { Db } from '../../../shared/db';
import type { AuditRecorder } from '../../../core/audit/audit.service';
import * as repo from './admin-users.repository';
import type { ListUsersFilter, RoleGrantRow, UserBaseRow, UserRow } from './admin-users.repository';

export class AdminUsersService {
  constructor(
    private readonly db: Db,
    private readonly audit?: AuditRecorder,
  ) {}

  listUsers(filter: ListUsersFilter = {}): Promise<UserRow[]> {
    return repo.listUsers(this.db, filter);
  }

  getUser(id: string): Promise<UserRow | null> {
    return repo.getUser(this.db, id);
  }

  async updateStatus(id: string, status: string, actorId: string): Promise<UserBaseRow | null> {
    const updated = await repo.updateUserStatus(this.db, id, status);
    if (!updated) return null;
    await this.audit?.record({
      actorId,
      action: 'admin.user.status_changed',
      resourceType: 'user',
      resourceId: id,
      metadata: { status },
    });
    return updated;
  }

  listUserRoles(userId: string): Promise<RoleGrantRow[]> {
    return repo.listUserRoles(this.db, userId);
  }

  async grantRole(
    userId: string,
    roleCode: string,
    placeId: string | null,
    grantedBy: string,
  ): Promise<RoleGrantRow> {
    const grant = await repo.grantRole(this.db, userId, roleCode, placeId, grantedBy);
    await this.audit?.record({
      actorId: grantedBy,
      action: 'admin.role.granted',
      resourceType: 'user',
      resourceId: userId,
      placeId,
      metadata: { roleCode, placeId },
    });
    return grant;
  }

  /** Fetches the grant first so the audit entry keeps its user/role context. */
  async revokeRole(roleGrantId: string, actorId: string): Promise<{ id: string } | null> {
    const grant = await repo.getRoleGrant(this.db, roleGrantId);
    const deleted = await repo.revokeRole(this.db, roleGrantId);
    if (!deleted) return null;
    await this.audit?.record({
      actorId,
      action: 'admin.role.revoked',
      resourceType: 'user',
      resourceId: grant?.user_id ?? null,
      placeId: grant?.place_id ?? null,
      metadata: { roleGrantId, roleCode: grant?.role_code ?? null },
    });
    return deleted;
  }
}
