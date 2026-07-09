/**
 * Shelter / safe-zone registry endpoints, mounted at /api/v1/shelters
 * (Module M — Emergency Response & Coordination). Mirrors
 * health-facility.routes.ts's shape (resolveTargetPlace + geo-scoped RBAC),
 * plus an occupancy-adjustment route and a public, unauthenticated "nearest
 * open shelter" lookup — citizens need this during an active event, so it's
 * held to the same openness level as the hazard map.
 */
import { Router, type Request, type RequestHandler, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import type { Permission } from '@nexus/shared';
import type { CoreServices } from '../../../core/http/container';
import { requirePermission } from '../../../core/rbac/rbac.middleware';
import type { ShelterService } from './shelter.service';

const { authenticate } = require('../../../middleware/auth') as { authenticate: RequestHandler };

const STATUS = ['open', 'full', 'closed'] as const;

const CREATE_PERM: Permission = 'shelter.create';
const READ_PERM: Permission = 'shelter.read';
const MANAGE_PERM: Permission = 'shelter.manage';

const registerSchema = z.object({
  placeId: z.string().uuid().optional(),
  lng: z.number().min(-180).max(180).optional(),
  lat: z.number().min(-90).max(90).optional(),
  name: z.string().min(2).max(200),
  capacity: z.number().int().min(0).optional(),
  facilities: z.array(z.string()).optional(),
  contactPhone: z.string().min(8).max(20).optional(),
  managedBy: z.string().uuid().optional(),
  notes: z.string().max(2000).optional(),
});

const updateSchema = z.object({
  name: z.string().min(2).max(200).optional(),
  capacity: z.number().int().min(0).nullable().optional(),
  status: z.enum(STATUS).optional(),
  contactPhone: z.string().min(8).max(20).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  facilities: z.array(z.string()).optional(),
});

const occupancySchema = z.object({
  delta: z.number().int(),
});

const nearestSchema = z.object({
  lng: z.coerce.number().min(-180).max(180),
  lat: z.coerce.number().min(-90).max(90),
  limit: z.coerce.number().int().min(1).max(20).optional(),
});

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const actorOf = (req: Request): string => (req as Request & { user?: { id: string } }).user?.id ?? '';

/** Request-scoped storage for the place resolved from body.placeId/lng/lat (register route). */
interface ResolvedPlaceRequest extends Request {
  resolvedPlaceId?: string | null;
}

/**
 * Dependencies this router needs. Typed as a subset of `CoreServices` plus
 * the not-yet-wired `shelters` service, so this file type-checks standalone
 * before the orchestrator adds a `shelters: ShelterService` field to
 * `CoreServices` (see README "Wiring needed").
 */
type ShelterRouterDeps = Pick<CoreServices, 'geography' | 'rbac'> & { shelters: ShelterService };

export function buildShelterRouter({ shelters, geography, rbac }: ShelterRouterDeps): Router {
  const router = Router();

  // Public, read-only "nearest open shelter" lookup — no auth/RBAC. Registered
  // before `router.use(authenticate)` so it never hits that middleware.
  router.get('/nearest', async (req, res) => {
    const parsed = nearestSchema.safeParse({
      lng: req.query.lng,
      lat: req.query.lat,
      limit: req.query.limit,
    });
    if (!parsed.success) {
      res.status(400).json({ success: false, message: 'lng and lat query params are required', errors: parsed.error.flatten() });
      return;
    }
    const { lng, lat, limit } = parsed.data;
    const rows = await shelters.findNearestOpen({ lng, lat }, limit ?? 5);
    res.json({ success: true, count: rows.length, data: rows });
  });

  router.use(authenticate);

  // Resolve the target place ONCE (from placeId, or lng/lat via reverse geocode) so
  // both the permission check and the handler use the same value.
  const resolveTargetPlace = async (req: ResolvedPlaceRequest, _res: Response, next: NextFunction) => {
    const body = req.body as { placeId?: unknown; lng?: unknown; lat?: unknown };
    const placeId = typeof body.placeId === 'string' ? body.placeId : undefined;
    const lng = typeof body.lng === 'number' ? body.lng : undefined;
    const lat = typeof body.lat === 'number' ? body.lat : undefined;
    req.resolvedPlaceId = placeId ?? (await shelters.resolvePlace(lng, lat));
    next();
  };

  router.post(
    '/',
    resolveTargetPlace,
    requirePermission(rbac, CREATE_PERM, async (req) => {
      const placeId = (req as ResolvedPlaceRequest).resolvedPlaceId;
      if (!placeId) return null;
      return (await geography.getById(placeId))?.path ?? null;
    }),
    async (req, res) => {
      const parsed = registerSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ success: false, message: 'Invalid shelter registration', errors: parsed.error.flatten() });
        return;
      }
      const placeId = (req as ResolvedPlaceRequest).resolvedPlaceId;
      if (!placeId) {
        res.status(400).json({ success: false, message: 'placeId or resolvable lng/lat is required' });
        return;
      }
      const shelter = await shelters.register({ ...parsed.data, placeId }, actorOf(req));
      res.status(201).json({ success: true, data: shelter });
    },
  );

  // List within a scope (district/region) — perm shelter.read, checked against that scope.
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
      const rows = await shelters.listByScope(scope, {
        status: str(req.query.status),
        hasCapacity: str(req.query.hasCapacity) === 'true' ? true : undefined,
      });
      res.json({ success: true, count: rows.length, data: rows });
    },
  );

  router.get(
    '/:id',
    requirePermission(rbac, READ_PERM, (req) => shelters.shelterPlacePath(String(req.params.id))),
    async (req, res) => {
      const shelter = await shelters.getShelter(String(req.params.id));
      if (!shelter) {
        res.status(404).json({ success: false, message: 'Not found' });
        return;
      }
      res.json({ success: true, data: shelter });
    },
  );

  router.patch(
    '/:id',
    requirePermission(rbac, MANAGE_PERM, (req) => shelters.shelterPlacePath(String(req.params.id))),
    async (req, res) => {
      const parsed = updateSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ success: false, message: 'Invalid update', errors: parsed.error.flatten() });
        return;
      }
      try {
        const shelter = await shelters.update(String(req.params.id), parsed.data, actorOf(req));
        res.json({ success: true, data: shelter });
      } catch (err) {
        res.status(404).json({ success: false, message: (err as Error).message });
      }
    },
  );

  // Occupancy check-in/out — perm shelter.manage, scoped to the shelter's place.
  router.post(
    '/:id/occupancy',
    requirePermission(rbac, MANAGE_PERM, (req) => shelters.shelterPlacePath(String(req.params.id))),
    async (req, res) => {
      const parsed = occupancySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ success: false, message: 'Invalid occupancy adjustment', errors: parsed.error.flatten() });
        return;
      }
      try {
        const shelter = await shelters.adjustOccupancy(String(req.params.id), parsed.data.delta, actorOf(req));
        res.json({ success: true, data: shelter });
      } catch (err) {
        res.status(404).json({ success: false, message: (err as Error).message });
      }
    },
  );

  return router;
}
