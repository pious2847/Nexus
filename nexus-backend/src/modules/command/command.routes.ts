/**
 * Common Operating Picture + Incident Command endpoints (N14), mounted at
 * /api/v1/hazards/events/:id/cop. `command.read`/`command.manage` are
 * scoped to the hazard event's own place — the same pattern every other
 * event-scoped route in this codebase uses.
 */
import { Router, type Request, type RequestHandler } from 'express';
import { z } from 'zod';
import type { Permission } from '@nexus/shared';
import type { CoreServices } from '../../core/http/container';
import { requirePermission } from '../../core/rbac/rbac.middleware';
import type { CommandService } from './command.service';

const { authenticate } = require('../../middleware/auth') as { authenticate: RequestHandler };

const READ_PERM: Permission = 'command.read';
const MANAGE_PERM: Permission = 'command.manage';

const ROLE_TITLES = [
  'incident_commander', 'operations', 'planning', 'logistics', 'finance_admin', 'safety_officer', 'liaison_officer', 'public_information_officer',
] as const;

const assignSchema = z.object({
  roleTitle: z.enum(ROLE_TITLES),
  userId: z.string().uuid(),
});

const actorOf = (req: Request): string => (req as Request & { user?: { id: string } }).user?.id ?? '';

export type CommandRouterDeps = Pick<CoreServices, 'rbac'> & { command: CommandService };

export function buildCommandRouter({ command, rbac }: CommandRouterDeps): Router {
  const router = Router({ mergeParams: true });
  router.use(authenticate);

  router.get(
    '/',
    requirePermission(rbac, READ_PERM, (req) => command.eventPlacePath(String(req.params.id))),
    async (req, res) => {
      try {
        const snapshot = await command.getCop(String(req.params.id));
        res.json({ success: true, data: snapshot });
      } catch (err) {
        res.status(404).json({ success: false, message: (err as Error).message });
      }
    },
  );

  router.post(
    '/roles',
    requirePermission(rbac, MANAGE_PERM, (req) => command.eventPlacePath(String(req.params.id))),
    async (req, res) => {
      const parsed = assignSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ success: false, message: 'Invalid role assignment', errors: parsed.error.flatten() });
        return;
      }
      try {
        const role = await command.assignRole(String(req.params.id), parsed.data.roleTitle, parsed.data.userId, actorOf(req));
        res.status(201).json({ success: true, data: role });
      } catch (err) {
        res.status(400).json({ success: false, message: (err as Error).message });
      }
    },
  );

  router.delete(
    '/roles/:roleId',
    requirePermission(rbac, MANAGE_PERM, (req) => command.eventPlacePath(String(req.params.id))),
    async (req, res) => {
      try {
        const role = await command.relieveRole(String(req.params.roleId), actorOf(req));
        res.json({ success: true, data: role });
      } catch (err) {
        res.status(404).json({ success: false, message: (err as Error).message });
      }
    },
  );

  return router;
}
