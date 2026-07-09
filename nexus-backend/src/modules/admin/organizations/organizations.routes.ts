/**
 * Organization & team management endpoints, mounted at
 * /api/v1/admin/organizations (Module A foundation gap). Reuses the
 * pre-existing `org.manage` permission (already in the RBAC catalog,
 * granted to super_admin via `'*'`, but with no implementing routes
 * anywhere until now). National-scope only, no `resolveTargetPath` —
 * mirrors admin-users.routes.ts's reasoning (org administration isn't
 * geo-scoped).
 */
import { Router, type Request, type RequestHandler } from 'express';
import { z } from 'zod';
import type { CoreServices } from '../../../core/http/container';
import { requirePermission } from '../../../core/rbac/rbac.middleware';
import type { OrganizationsService } from './organizations.service';

const { authenticate } = require('../../../middleware/auth') as { authenticate: RequestHandler };

const ORG_TYPES = ['ngo', 'government_agency', 'assembly', 'research', 'media', 'other'] as const;

const createSchema = z.object({
  name: z.string().min(2).max(200),
  type: z.enum(ORG_TYPES),
  contact: z.record(z.string(), z.unknown()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const updateSchema = z.object({
  name: z.string().min(2).max(200).optional(),
  type: z.enum(ORG_TYPES).optional(),
  contact: z.record(z.string(), z.unknown()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const verifySchema = z.object({ verified: z.boolean() });

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const actorOf = (req: Request): string => (req as Request & { user?: { id: string } }).user?.id ?? '';

export type OrganizationsRouterDeps = Pick<CoreServices, 'rbac'> & { organizations: OrganizationsService };

export function buildOrganizationsRouter({ organizations, rbac }: OrganizationsRouterDeps): Router {
  const router = Router();
  router.use(authenticate);

  router.get('/', requirePermission(rbac, 'org.manage'), async (req, res) => {
    const verified = req.query.verified === 'true' ? true : req.query.verified === 'false' ? false : undefined;
    const rows = await organizations.listOrgs({ type: str(req.query.type), verified, search: str(req.query.search) });
    res.json({ success: true, count: rows.length, data: rows });
  });

  router.get('/:id', requirePermission(rbac, 'org.manage'), async (req, res) => {
    const org = await organizations.getOrg(String(req.params.id));
    if (!org) {
      res.status(404).json({ success: false, message: 'Not found' });
      return;
    }
    res.json({ success: true, data: org });
  });

  router.get('/:id/members', requirePermission(rbac, 'org.manage'), async (req, res) => {
    const org = await organizations.getOrg(String(req.params.id));
    if (!org) {
      res.status(404).json({ success: false, message: 'Not found' });
      return;
    }
    const rows = await organizations.listMembers(String(req.params.id));
    res.json({ success: true, count: rows.length, data: rows });
  });

  router.post('/', requirePermission(rbac, 'org.manage'), async (req, res) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, message: 'Invalid organization', errors: parsed.error.flatten() });
      return;
    }
    const org = await organizations.create(parsed.data, actorOf(req));
    res.status(201).json({ success: true, data: org });
  });

  router.patch('/:id', requirePermission(rbac, 'org.manage'), async (req, res) => {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, message: 'Invalid update', errors: parsed.error.flatten() });
      return;
    }
    try {
      const org = await organizations.update(String(req.params.id), parsed.data, actorOf(req));
      res.json({ success: true, data: org });
    } catch (err) {
      res.status(404).json({ success: false, message: (err as Error).message });
    }
  });

  router.post('/:id/verify', requirePermission(rbac, 'org.manage'), async (req, res) => {
    const parsed = verifySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, message: 'verified (boolean) is required' });
      return;
    }
    try {
      const org = await organizations.setVerified(String(req.params.id), parsed.data.verified, actorOf(req));
      res.json({ success: true, data: org });
    } catch (err) {
      res.status(404).json({ success: false, message: (err as Error).message });
    }
  });

  return router;
}
