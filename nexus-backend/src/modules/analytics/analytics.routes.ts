/**
 * Executive summary / trend analytics endpoints, mounted at /api/v1/analytics
 * (Module K). Read-only, gated by analytics.read, geo-scoped like every other
 * "list within a scope" route (see shelter.routes.ts).
 */
import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import type { Permission } from '@nexus/shared';
import type { CoreServices } from '../../core/http/container';
import { requirePermission } from '../../core/rbac/rbac.middleware';
import type { AnalyticsService } from './analytics.service';

const { authenticate } = require('../../middleware/auth') as { authenticate: RequestHandler };

const READ_PERM: Permission = 'analytics.read';

const trendsSchema = z.object({
  months: z.coerce.number().int().min(1).max(36).optional(),
  scope: z.string().uuid().optional(),
});

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

type AnalyticsRouterDeps = Pick<CoreServices, 'geography' | 'rbac'> & { analytics: AnalyticsService };

export function buildAnalyticsRouter({ analytics, geography, rbac }: AnalyticsRouterDeps): Router {
  const router = Router();

  router.use(authenticate);

  // Executive summary always requires a scope (district/region/national place id) —
  // there is deliberately no "everyone nationally, no scope" query, same rule as
  // every repository query in this module.
  router.get(
    '/executive-summary',
    requirePermission(rbac, READ_PERM, async (req) => {
      const scope = str(req.query.scope);
      return scope ? (await geography.getById(scope))?.path ?? null : null;
    }),
    async (req, res) => {
      const scope = str(req.query.scope);
      if (!scope) {
        res.status(400).json({ success: false, message: 'scope (a place id) query param is required' });
        return;
      }
      const summary = await analytics.executiveSummary(scope);
      res.json({ success: true, data: summary });
    },
  );

  // Trend chart — scope optional; omitting it requires national-level access
  // (requirePermission checks against a null targetPath, i.e. unscoped).
  router.get(
    '/trends',
    requirePermission(rbac, READ_PERM, async (req) => {
      const scope = str(req.query.scope);
      return scope ? (await geography.getById(scope))?.path ?? null : null;
    }),
    async (req, res) => {
      const parsed = trendsSchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json({ success: false, message: 'Invalid query', errors: parsed.error.flatten() });
        return;
      }
      const rows = await analytics.trends(parsed.data.months ?? 12, parsed.data.scope);
      res.json({ success: true, count: rows.length, data: rows });
    },
  );

  return router;
}
