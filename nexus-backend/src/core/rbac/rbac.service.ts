/**
 * RBAC service — the DB-backed `can()` used by the request path. Loads the
 * caller's grants and delegates to the pure decision logic.
 */
import type { Permission } from '@nexus/shared';
import type { Db } from '../../shared/db';
import { can } from './rbac';
import { getUserGrants } from './rbac.repository';

export class RbacService {
  constructor(private readonly db: Db) {}

  /**
   * Can `userId` perform `permission` on the place at `targetPath`?
   * Pass targetPath = null for actions not tied to a specific place (national).
   */
  async can(userId: string, permission: Permission, targetPath: string | null = null): Promise<boolean> {
    const grants = await getUserGrants(this.db, userId);
    return can(grants, permission, targetPath);
  }
}
