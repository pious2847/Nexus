/**
 * Admin user & role management endpoints, intended mount:
 * /api/v1/admin/users (Module A/L gap). Reuses two permissions that already
 * existed in the RBAC catalog but had no implementing routes anywhere:
 * `user.manage` and `role.assign` (both already granted to super_admin via
 * `'*'`, see packages/shared/src/constants/permissions.ts).
 *
 * Every route here calls `requirePermission(rbac, perm)` with NO
 * `resolveTargetPath` — user/role administration is inherently a
 * platform-wide action, not geo-scoped, so only a national-level grant of
 * the permission passes (see rbac.middleware.ts's doc comment: omitting the
 * third arg means the check is against `targetPath = null`).
 */
import { Router, type Request, type RequestHandler } from 'express';
import { z } from 'zod';
import { ROLES } from '@nexus/shared';
import type { CoreServices } from '../../../core/http/container';
import { requirePermission } from '../../../core/rbac/rbac.middleware';
import type { AdminUsersService } from './admin-users.service';

const { authenticate } = require('../../../middleware/auth') as { authenticate: RequestHandler };

const statusSchema = z.object({
  status: z.enum(['active', 'suspended']),
});

const grantRoleSchema = z.object({
  roleCode: z.enum(ROLES),
  placeId: z.string().uuid().nullable().optional(),
});

const actorOf = (req: Request): string => (req as Request & { user?: { id: string } }).user?.id ?? '';

/**
 * Dependencies this router needs. Typed as a subset of `CoreServices` plus
 * the not-yet-wired `adminUsers` service, so this file type-checks
 * standalone before the orchestrator adds an `adminUsers: AdminUsersService`
 * field to `CoreServices` (see README "Wiring needed").
 */
export type AdminUsersRouterDeps = Pick<CoreServices, 'rbac'> & { adminUsers: AdminUsersService };

export function buildAdminUsersRouter({ adminUsers, rbac }: AdminUsersRouterDeps): Router {
  const router = Router();
  router.use(authenticate);

  router.get('/', requirePermission(rbac, 'user.manage'), async (req, res) => {
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const search = typeof req.query.search === 'string' ? req.query.search : undefined;
    const rows = await adminUsers.listUsers({ status, search });
    res.json({ success: true, count: rows.length, data: rows });
  });

  router.get('/:id', requirePermission(rbac, 'user.manage'), async (req, res) => {
    const user = await adminUsers.getUser(String(req.params.id));
    if (!user) {
      res.status(404).json({ success: false, message: 'Not found' });
      return;
    }
    res.json({ success: true, data: user });
  });

  router.patch('/:id/status', requirePermission(rbac, 'user.manage'), async (req, res) => {
    const parsed = statusSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, message: 'Invalid status', errors: parsed.error.flatten() });
      return;
    }
    const updated = await adminUsers.updateStatus(String(req.params.id), parsed.data.status, actorOf(req));
    if (!updated) {
      res.status(404).json({ success: false, message: 'Not found' });
      return;
    }
    res.json({ success: true, data: updated });
  });

  router.get('/:id/roles', requirePermission(rbac, 'user.manage'), async (req, res) => {
    const rows = await adminUsers.listUserRoles(String(req.params.id));
    res.json({ success: true, count: rows.length, data: rows });
  });

  router.post('/:id/roles', requirePermission(rbac, 'role.assign'), async (req, res) => {
    const parsed = grantRoleSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, message: 'Invalid role grant', errors: parsed.error.flatten() });
      return;
    }
    const grant = await adminUsers.grantRole(
      String(req.params.id),
      parsed.data.roleCode,
      parsed.data.placeId ?? null,
      actorOf(req),
    );
    res.status(201).json({ success: true, data: grant });
  });

  router.delete('/:id/roles/:roleGrantId', requirePermission(rbac, 'role.assign'), async (req, res) => {
    const deleted = await adminUsers.revokeRole(String(req.params.roleGrantId), actorOf(req));
    if (!deleted) {
      res.status(404).json({ success: false, message: 'Not found' });
      return;
    }
    res.json({ success: true, data: deleted });
  });

  return router;
}
