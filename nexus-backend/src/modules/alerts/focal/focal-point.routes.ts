/**
 * Community focal point registry endpoints, mounted at
 * /api/v1/community-focal-points (spec 02 N6).
 */
import { Router, type Request, type RequestHandler, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import type { CoreServices } from '../../../core/http/container';
import { requirePermission } from '../../../core/rbac/rbac.middleware';

const { authenticate } = require('../../../middleware/auth') as { authenticate: RequestHandler };

const RELAY_METHODS = ['door_to_door', 'gong_gong', 'loudhailer', 'radio_broadcast', 'notice_board'] as const;

const registerSchema = z.object({
  placeId: z.string().uuid().optional(),
  lng: z.number().min(-180).max(180).optional(),
  lat: z.number().min(-90).max(90).optional(),
  name: z.string().min(2).max(200),
  relayMethod: z.enum(RELAY_METHODS),
  stationName: z.string().max(200).optional(),
  contactPhone: z.string().min(8).max(20).optional(),
  contactEmail: z.string().email().optional(),
  notes: z.string().max(500).optional(),
});

const updateSchema = z.object({
  name: z.string().min(2).max(200).optional(),
  relayMethod: z.enum(RELAY_METHODS).optional(),
  stationName: z.string().max(200).optional(),
  contactPhone: z.string().min(8).max(20).optional(),
  contactEmail: z.string().email().optional(),
  notes: z.string().max(500).optional(),
  active: z.boolean().optional(),
});

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const actorOf = (req: Request): string => (req as Request & { user?: { id: string } }).user?.id ?? '';

interface ResolvedPlaceRequest extends Request {
  resolvedPlaceId?: string | null;
}

export function buildFocalPointRouter({ focalPoints, geography, rbac }: CoreServices): Router {
  const router = Router();
  router.use(authenticate);

  const resolveTargetPlace = async (req: ResolvedPlaceRequest, _res: Response, next: NextFunction) => {
    const body = req.body as { placeId?: unknown; lng?: unknown; lat?: unknown };
    const placeId = typeof body.placeId === 'string' ? body.placeId : undefined;
    const lng = typeof body.lng === 'number' ? body.lng : undefined;
    const lat = typeof body.lat === 'number' ? body.lat : undefined;
    req.resolvedPlaceId = placeId ?? (await focalPoints.resolvePlace(lng, lat));
    next();
  };

  router.post(
    '/',
    resolveTargetPlace,
    requirePermission(rbac, 'focal.create', async (req) => {
      const placeId = (req as ResolvedPlaceRequest).resolvedPlaceId;
      if (!placeId) return null;
      return (await geography.getById(placeId))?.path ?? null;
    }),
    async (req, res) => {
      const parsed = registerSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ success: false, message: 'Invalid focal point', errors: parsed.error.flatten() });
        return;
      }
      const placeId = (req as ResolvedPlaceRequest).resolvedPlaceId;
      if (!placeId) {
        res.status(400).json({ success: false, message: 'placeId or resolvable lng/lat is required' });
        return;
      }
      const point = await focalPoints.register({ ...parsed.data, placeId }, actorOf(req));
      res.status(201).json({ success: true, data: point });
    },
  );

  router.get(
    '/',
    requirePermission(rbac, 'focal.read', async (req) => {
      const scope = str(req.query.scope);
      return scope ? (await geography.getById(scope))?.path ?? null : null;
    }),
    async (req, res) => {
      const scope = str(req.query.scope);
      if (!scope) {
        res.status(400).json({ success: false, message: 'scope (a place id) query param is required' });
        return;
      }
      const rows = await focalPoints.listByScope(scope, {
        relayMethod: str(req.query.relayMethod),
        active: req.query.active === undefined ? undefined : req.query.active === 'true',
      });
      res.json({ success: true, count: rows.length, data: rows });
    },
  );

  router.get(
    '/:id',
    requirePermission(rbac, 'focal.read', (req) => focalPoints.focalPointPlacePath(String(req.params.id))),
    async (req, res) => {
      const point = await focalPoints.getFocalPoint(String(req.params.id));
      if (!point) {
        res.status(404).json({ success: false, message: 'Not found' });
        return;
      }
      res.json({ success: true, data: point });
    },
  );

  router.patch(
    '/:id',
    requirePermission(rbac, 'focal.manage', (req) => focalPoints.focalPointPlacePath(String(req.params.id))),
    async (req, res) => {
      const parsed = updateSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ success: false, message: 'Invalid update', errors: parsed.error.flatten() });
        return;
      }
      try {
        const point = await focalPoints.update(String(req.params.id), parsed.data, actorOf(req));
        res.json({ success: true, data: point });
      } catch (err) {
        res.status(404).json({ success: false, message: (err as Error).message });
      }
    },
  );

  return router;
}
