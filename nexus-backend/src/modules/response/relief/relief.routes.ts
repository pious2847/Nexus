/**
 * Relief-inventory endpoints, mounted at /api/v1/relief (Module M —
 * Emergency Response & Coordination). Stock records live at a place (and
 * optionally a shelter); distributions decrement stock atomically at the
 * repository layer. Mirrors shelter.routes.ts / health-facility.routes.ts —
 * `POST /` needs geography (to resolve lng/lat -> placeId) even though
 * ReliefService itself has no geography dependency.
 */
import { Router, type Request, type RequestHandler, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import type { Permission } from '@nexus/shared';
import type { CoreServices } from '../../../core/http/container';
import { requirePermission } from '../../../core/rbac/rbac.middleware';
import type { ReliefService } from './relief.service';

const { authenticate } = require('../../../middleware/auth') as { authenticate: RequestHandler };

const ITEM_TYPES = ['food', 'water', 'tents', 'medical_kits', 'blankets', 'other'] as const;

const READ_PERM: Permission = 'relief.read';
const MANAGE_PERM: Permission = 'relief.manage';

const recordStockSchema = z.object({
  placeId: z.string().uuid().optional(),
  lng: z.number().min(-180).max(180).optional(),
  lat: z.number().min(-90).max(90).optional(),
  shelterId: z.string().uuid().optional(),
  itemType: z.enum(ITEM_TYPES),
  quantity: z.number().int().min(0).optional(),
  unit: z.string().min(1).max(20).optional(),
  lowStockThreshold: z.number().int().min(0).optional(),
});

const adjustSchema = z.object({
  delta: z.number().int(),
});

const distributeSchema = z.object({
  quantity: z.number().int().positive(),
  recipientDesc: z.string().max(500).optional(),
  hazardEventId: z.string().uuid().optional(),
});

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const actorOf = (req: Request): string => (req as Request & { user?: { id: string } }).user?.id ?? '';

/** Request-scoped storage for the place resolved from body.placeId/lng/lat (record-stock route). */
interface ResolvedPlaceRequest extends Request {
  resolvedPlaceId?: string | null;
}

/**
 * Dependencies this router needs. Typed as a subset of `CoreServices` plus
 * the not-yet-wired `relief` service, so this file type-checks standalone
 * before the orchestrator adds a `relief: ReliefService` field to
 * `CoreServices` (see README "Wiring needed").
 */
type ReliefRouterDeps = Pick<CoreServices, 'geography' | 'rbac'> & { relief: ReliefService };

export function buildReliefRouter({ relief, geography, rbac }: ReliefRouterDeps): Router {
  const router = Router();
  router.use(authenticate);

  // Resolve the target place ONCE (from placeId, or lng/lat via reverse geocode) so
  // both the permission check and the handler use the same value.
  const resolveTargetPlace = async (req: ResolvedPlaceRequest, _res: Response, next: NextFunction) => {
    const body = req.body as { placeId?: unknown; lng?: unknown; lat?: unknown };
    const placeId = typeof body.placeId === 'string' ? body.placeId : undefined;
    const lng = typeof body.lng === 'number' ? body.lng : undefined;
    const lat = typeof body.lat === 'number' ? body.lat : undefined;
    req.resolvedPlaceId =
      placeId ?? (lng != null && lat != null ? (await geography.districtForPoint({ lng, lat }))?.id ?? null : null);
    next();
  };

  router.post(
    '/',
    resolveTargetPlace,
    requirePermission(rbac, MANAGE_PERM, async (req) => {
      const placeId = (req as ResolvedPlaceRequest).resolvedPlaceId;
      if (!placeId) return null;
      return (await geography.getById(placeId))?.path ?? null;
    }),
    async (req, res) => {
      const parsed = recordStockSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ success: false, message: 'Invalid stock record', errors: parsed.error.flatten() });
        return;
      }
      const placeId = (req as ResolvedPlaceRequest).resolvedPlaceId;
      if (!placeId) {
        res.status(400).json({ success: false, message: 'placeId or resolvable lng/lat is required' });
        return;
      }
      const { lng: _lng, lat: _lat, ...rest } = parsed.data;
      const stock = await relief.recordStock({ ...rest, placeId }, actorOf(req));
      res.status(201).json({ success: true, data: stock });
    },
  );

  // List within a scope (district/region) — perm relief.read, checked against that scope.
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
      const rows = await relief.listByScope(scope, {
        itemType: str(req.query.itemType),
        lowStockOnly: str(req.query.lowStockOnly) === 'true' ? true : undefined,
      });
      res.json({ success: true, count: rows.length, data: rows });
    },
  );

  router.get(
    '/:id',
    requirePermission(rbac, READ_PERM, (req) => relief.stockPlacePath(String(req.params.id))),
    async (req, res) => {
      const stock = await relief.getStock(String(req.params.id));
      if (!stock) {
        res.status(404).json({ success: false, message: 'Not found' });
        return;
      }
      res.json({ success: true, data: stock });
    },
  );

  router.patch(
    '/:id/adjust',
    requirePermission(rbac, MANAGE_PERM, (req) => relief.stockPlacePath(String(req.params.id))),
    async (req, res) => {
      const parsed = adjustSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ success: false, message: 'Invalid adjustment', errors: parsed.error.flatten() });
        return;
      }
      try {
        const stock = await relief.adjustStock(String(req.params.id), parsed.data.delta, actorOf(req));
        res.json({ success: true, data: stock });
      } catch (err) {
        res.status(404).json({ success: false, message: (err as Error).message });
      }
    },
  );

  router.post(
    '/:id/distribute',
    requirePermission(rbac, MANAGE_PERM, (req) => relief.stockPlacePath(String(req.params.id))),
    async (req, res) => {
      const parsed = distributeSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ success: false, message: 'Invalid distribution', errors: parsed.error.flatten() });
        return;
      }
      try {
        const distribution = await relief.distribute(String(req.params.id), parsed.data, actorOf(req));
        res.status(201).json({ success: true, data: distribution });
      } catch (err) {
        const message = (err as Error).message;
        // "Insufficient stock" / "must be positive" are business-rule 400s;
        // "not found" is a 404. Match on the not-found case explicitly.
        const status = message.toLowerCase().includes('not found') ? 404 : 400;
        res.status(status).json({ success: false, message });
      }
    },
  );

  router.get(
    '/:id/distributions',
    requirePermission(rbac, READ_PERM, (req) => relief.stockPlacePath(String(req.params.id))),
    async (req, res) => {
      const rows = await relief.listDistributions(String(req.params.id));
      res.json({ success: true, count: rows.length, data: rows });
    },
  );

  return router;
}
