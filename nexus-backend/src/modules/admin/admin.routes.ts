/**
 * Platform admin diagnostics, mounted at /api/v1/admin (Module L).
 * config.manage only (super_admin by default) — this is ops-sensitive
 * visibility, not a citizen or field-role surface.
 */
import { Router, type RequestHandler } from 'express';
import type { CoreServices } from '../../core/http/container';
import { requirePermission } from '../../core/rbac/rbac.middleware';
import { getIntegrationsStatus } from './integrations-status.service';

const { authenticate } = require('../../middleware/auth') as { authenticate: RequestHandler };

export function buildAdminRouter({ systemHealth, rbac }: CoreServices): Router {
  const router = Router();
  router.use(authenticate);
  router.use(requirePermission(rbac, 'config.manage'));

  router.get('/system-health', async (_req, res) => {
    res.json({ success: true, data: await systemHealth.getHealth() });
  });

  router.get('/integrations-status', (_req, res) => {
    res.json({ success: true, data: getIntegrationsStatus() });
  });

  return router;
}
