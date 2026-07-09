/**
 * Official myth-vs-fact clarification endpoints, mounted at
 * /api/v1/myth-facts (Module N — N11 Rumor & misinformation control).
 * `GET /` and `GET /:id` are PUBLIC — no auth/RBAC at all, since this is a
 * citizen-facing clarification feed (same openness level as the hazard map
 * / shelter.routes.ts's `/nearest`). Only `POST /` (publish) requires
 * authentication + `mythfact.publish`, so `authenticate` is applied to that
 * single route rather than globally via `router.use()` (mirrors
 * shelter.routes.ts's pattern of registering a public route before
 * `router.use(authenticate)`, just inverted: here the public routes are the
 * majority, so auth is scoped onto the one route that needs it).
 */
import { Router } from 'express';
import { z } from 'zod';
import type { Request, RequestHandler } from 'express';
import type { Permission } from '@nexus/shared';
import type { CoreServices } from '../../core/http/container';
import { requirePermission } from '../../core/rbac/rbac.middleware';
import type { MythFactService } from './mythfact.service';

const { authenticate } = require('../../middleware/auth') as { authenticate: RequestHandler };

const PUBLISH_PERM: Permission = 'mythfact.publish';

const publishSchema = z.object({
  myth: z.string().min(2).max(4000),
  fact: z.string().min(2).max(4000),
  hazardEventId: z.string().uuid().optional(),
  placeId: z.string().uuid().optional(),
  rumorReportId: z.string().uuid().optional(),
});

const listSchema = z.object({
  scope: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

const actorOf = (req: Request): string => (req as Request & { user?: { id: string } }).user?.id ?? '';

/**
 * Dependencies this router needs. Typed as a subset of `CoreServices` plus
 * the not-yet-wired `mythFacts` service, so this file type-checks
 * standalone before the orchestrator adds a `mythFacts: MythFactService`
 * field to `CoreServices` (see README "Wiring needed").
 */
type MythFactRouterDeps = Pick<CoreServices, 'rbac'> & { mythFacts: MythFactService };

export function buildMythFactRouter({ mythFacts, rbac }: MythFactRouterDeps): Router {
  const router = Router();

  // Public clarification feed — no auth/RBAC. Optional `?scope=<placeId>` narrows
  // to a district/region subtree; omitted returns the most recent entries nationwide.
  router.get('/', async (req, res) => {
    const parsed = listSchema.safeParse({ scope: req.query.scope, limit: req.query.limit });
    if (!parsed.success) {
      res.status(400).json({ success: false, message: 'Invalid query', errors: parsed.error.flatten() });
      return;
    }
    const rows = await mythFacts.listPublic(parsed.data.scope ?? null, parsed.data.limit ?? 50);
    res.json({ success: true, count: rows.length, data: rows });
  });

  // Public — a single published clarification, no auth/RBAC.
  router.get('/:id', async (req, res) => {
    const entry = await mythFacts.getMythFact(String(req.params.id));
    if (!entry) {
      res.status(404).json({ success: false, message: 'Not found' });
      return;
    }
    res.json({ success: true, data: entry });
  });

  // Publish — authenticated + mythfact.publish. Scoped to placeId when given,
  // otherwise treated as a national-scope clarification.
  router.post(
    '/',
    authenticate,
    requirePermission(rbac, PUBLISH_PERM, async (req) => {
      const placeId = typeof (req.body as { placeId?: unknown }).placeId === 'string' ? (req.body as { placeId: string }).placeId : undefined;
      // No placeId → national-scope clarification, satisfied only by a national
      // mythfact.publish grant. A given placeId lets a district/regional-scoped
      // grant authorize publishing for their own area (mirrors rumor.routes.ts).
      return placeId ? mythFacts.resolvePlacePath(placeId) : null;
    }),
    async (req, res) => {
      const parsed = publishSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ success: false, message: 'Invalid clarification', errors: parsed.error.flatten() });
        return;
      }
      const entry = await mythFacts.publish(parsed.data, actorOf(req));
      res.status(201).json({ success: true, data: entry });
    },
  );

  return router;
}
