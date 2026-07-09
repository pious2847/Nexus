/**
 * Rumor intake & review endpoints, mounted at /api/v1/rumors (Module N —
 * N11 Rumor & misinformation control). Mirrors shelter.routes.ts's shape
 * (resolveTargetPlace + geo-scoped RBAC), with one difference: `placeId` is
 * OPTIONAL on report — a rumor can be phoned in with no resolvable location,
 * in which case it's only reachable by id and review requires
 * national-level `rumor.manage` (see rumor.repository.ts's
 * `rumorPlacePath`, which returns null for an unscoped rumor; `rbac.can()`
 * treats a null target path as "national scope").
 */
import { Router, type Request, type RequestHandler, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import type { Permission } from '@nexus/shared';
import type { CoreServices } from '../../core/http/container';
import { requirePermission } from '../../core/rbac/rbac.middleware';
import type { RumorService } from './rumor.service';

const { authenticate } = require('../../middleware/auth') as { authenticate: RequestHandler };

const STATUS = ['reported', 'reviewing', 'confirmed_false', 'confirmed_true', 'clarified'] as const;

const REPORT_PERM: Permission = 'rumor.report';
const READ_PERM: Permission = 'rumor.read';
const MANAGE_PERM: Permission = 'rumor.manage';

const reportSchema = z.object({
  placeId: z.string().uuid().optional(),
  lng: z.number().min(-180).max(180).optional(),
  lat: z.number().min(-90).max(90).optional(),
  hazardEventId: z.string().uuid().optional(),
  description: z.string().min(2).max(4000),
  source: z.string().max(200).optional(),
  reporterPhone: z.string().min(8).max(20).optional(),
});

const reviewSchema = z.object({
  status: z.enum(STATUS),
  resolutionNotes: z.string().max(4000).nullable().optional(),
});

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const actorOf = (req: Request): string => (req as Request & { user?: { id: string } }).user?.id ?? '';

/** Request-scoped storage for the place resolved from body.placeId/lng/lat (report route). */
interface ResolvedPlaceRequest extends Request {
  resolvedPlaceId?: string | null;
}

/**
 * Dependencies this router needs. Typed as a subset of `CoreServices` plus
 * the not-yet-wired `rumors` service, so this file type-checks standalone
 * before the orchestrator adds a `rumors: RumorService` field to
 * `CoreServices` (see README "Wiring needed").
 */
type RumorRouterDeps = Pick<CoreServices, 'geography' | 'rbac'> & { rumors: RumorService };

export function buildRumorRouter({ rumors, geography, rbac }: RumorRouterDeps): Router {
  const router = Router();

  router.use(authenticate);

  // Resolve the target place ONCE (from placeId, or lng/lat via reverse geocode) so
  // both the permission check and the handler use the same value. Unlike
  // shelter.routes.ts, a null result here is valid — an unscoped rumor report is
  // still accepted (mirrors rumor.report being open to all citizens regardless of
  // whether a place can be resolved).
  const resolveTargetPlace = async (req: ResolvedPlaceRequest, _res: Response, next: NextFunction) => {
    const body = req.body as { placeId?: unknown; lng?: unknown; lat?: unknown };
    const placeId = typeof body.placeId === 'string' ? body.placeId : undefined;
    const lng = typeof body.lng === 'number' ? body.lng : undefined;
    const lat = typeof body.lat === 'number' ? body.lat : undefined;
    req.resolvedPlaceId = placeId ?? (await rumors.resolvePlace(lng, lat));
    next();
  };

  router.post(
    '/',
    resolveTargetPlace,
    requirePermission(rbac, REPORT_PERM, async (req) => {
      const placeId = (req as ResolvedPlaceRequest).resolvedPlaceId;
      if (!placeId) return null;
      return (await geography.getById(placeId))?.path ?? null;
    }),
    async (req, res) => {
      const parsed = reportSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ success: false, message: 'Invalid rumor report', errors: parsed.error.flatten() });
        return;
      }
      const placeId = (req as ResolvedPlaceRequest).resolvedPlaceId ?? null;
      const { lng: _lng, lat: _lat, ...rest } = parsed.data;
      const rumor = await rumors.report({ ...rest, placeId }, actorOf(req));
      res.status(201).json({ success: true, data: rumor });
    },
  );

  // List within a scope (district/region) — perm rumor.read, checked against that scope.
  router.get(
    '/',
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
      const rows = await rumors.listByScope(scope, { status: str(req.query.status) });
      res.json({ success: true, count: rows.length, data: rows });
    },
  );

  router.get(
    '/:id',
    requirePermission(rbac, READ_PERM, (req) => rumors.rumorPlacePath(String(req.params.id))),
    async (req, res) => {
      const rumor = await rumors.getRumor(String(req.params.id));
      if (!rumor) {
        res.status(404).json({ success: false, message: 'Not found' });
        return;
      }
      res.json({ success: true, data: rumor });
    },
  );

  router.patch(
    '/:id',
    requirePermission(rbac, MANAGE_PERM, (req) => rumors.rumorPlacePath(String(req.params.id))),
    async (req, res) => {
      const parsed = reviewSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ success: false, message: 'Invalid review', errors: parsed.error.flatten() });
        return;
      }
      try {
        const rumor = await rumors.review(String(req.params.id), parsed.data, actorOf(req));
        res.json({ success: true, data: rumor });
      } catch (err) {
        res.status(404).json({ success: false, message: (err as Error).message });
      }
    },
  );

  return router;
}
