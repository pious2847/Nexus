/**
 * Health-facility registry endpoints, mounted at /api/v1/health-facilities.
 * Public infrastructure data (clinics, hospitals, CHPS compounds) — read access
 * is broader than the vulnerable-persons registry (field_worker can read too,
 * for the map layer), but registration/management still requires geo-scoped
 * RBAC (district_officer+ create; regional/national oversight can manage).
 *
 * N16 — live capacity & mass-casualty coordination additions:
 *   POST /:id/capacity              file a new capacity report (health.facility.manage, scoped)
 *   GET  /:id/capacity              latest capacity report, 200 {data: null} if none filed yet (health.facility.read, scoped)
 *   GET  /nearest-with-capacity     PUBLIC, no auth — nearest facility with a capacity report meeting filters (?lng=&lat=&minBeds=&status=&limit=)
 */
import { Router, type Request, type RequestHandler, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import type { Permission } from '@nexus/shared';
import type { CoreServices } from '../../../core/http/container';
import { requirePermission } from '../../../core/rbac/rbac.middleware';
import type { HealthFacilityService } from './health-facility.service';

const { authenticate } = require('../../../middleware/auth') as { authenticate: RequestHandler };

const FACILITY_TYPES = ['clinic', 'hospital', 'chps_compound', 'health_center'] as const;
const OWNERSHIP = ['government', 'private', 'mission', 'ngo'] as const;
const STATUS = ['active', 'closed'] as const;

const CREATE_PERM: Permission = 'health.facility.create';
const READ_PERM: Permission = 'health.facility.read';
const MANAGE_PERM: Permission = 'health.facility.manage';

const registerSchema = z.object({
  placeId: z.string().uuid().optional(),
  lng: z.number().min(-180).max(180).optional(),
  lat: z.number().min(-90).max(90).optional(),
  name: z.string().min(2).max(200),
  facilityType: z.enum(FACILITY_TYPES).default('clinic'),
  ownership: z.enum(OWNERSHIP).optional(),
  contactPhone: z.string().min(8).max(20).optional(),
  bedCount: z.number().int().min(0).optional(),
});

const updateSchema = z.object({
  name: z.string().min(2).max(200).optional(),
  facilityType: z.enum(FACILITY_TYPES).optional(),
  ownership: z.enum(OWNERSHIP).optional(),
  contactPhone: z.string().min(8).max(20).optional(),
  bedCount: z.number().int().min(0).optional(),
  status: z.enum(STATUS).optional(),
});

const CAPACITY_STATUS = ['normal', 'strained', 'overwhelmed', 'closed'] as const;

const capacityReportSchema = z.object({
  bedsAvailable: z.number().int().min(0).optional(),
  bloodUnitsAvailable: z.number().int().min(0).optional(),
  ambulancesAvailable: z.number().int().min(0).optional(),
  status: z.enum(CAPACITY_STATUS),
});

const nearestWithCapacitySchema = z.object({
  lng: z.coerce.number().min(-180).max(180),
  lat: z.coerce.number().min(-90).max(90),
  minBeds: z.coerce.number().int().min(0).optional(),
  status: z.enum(CAPACITY_STATUS).optional(),
  limit: z.coerce.number().int().min(1).max(20).optional(),
});

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const actorOf = (req: Request): string => (req as Request & { user?: { id: string } }).user?.id ?? '';

/** Request-scoped storage for the place resolved from body.placeId/lng/lat (register route). */
interface ResolvedPlaceRequest extends Request {
  resolvedPlaceId?: string | null;
}

/**
 * Dependencies this router needs. Typed as a subset of `CoreServices` plus the
 * not-yet-wired `healthFacilities` service, so this file type-checks standalone
 * before the orchestrator adds a `healthFacilities: HealthFacilityService` field
 * to `CoreServices` (see README "Wiring needed"). Once that field exists, a full
 * `CoreServices` object satisfies this type structurally — no change needed here.
 */
type HealthFacilityRouterDeps = Pick<CoreServices, 'geography' | 'rbac'> & { healthFacilities: HealthFacilityService };

export function buildHealthFacilityRouter({ healthFacilities, geography, rbac }: HealthFacilityRouterDeps): Router {
  const router = Router();

  // Public, read-only "nearest facility with capacity" lookup — no auth/RBAC.
  // Registered before `router.use(authenticate)` so it never hits that
  // middleware (mirrors shelter.routes.ts's /nearest — routing casualties to
  // a facility that actually has room is the same openness level as routing
  // people to an open shelter).
  router.get('/nearest-with-capacity', async (req, res) => {
    const parsed = nearestWithCapacitySchema.safeParse({
      lng: req.query.lng,
      lat: req.query.lat,
      minBeds: req.query.minBeds,
      status: req.query.status,
      limit: req.query.limit,
    });
    if (!parsed.success) {
      res.status(400).json({ success: false, message: 'lng and lat query params are required', errors: parsed.error.flatten() });
      return;
    }
    const { lng, lat, minBeds, status, limit } = parsed.data;
    const rows = await healthFacilities.findNearestWithCapacity({ lng, lat }, { minBeds, status }, limit ?? 5);
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
    req.resolvedPlaceId = placeId ?? (await healthFacilities.resolvePlace(lng, lat));
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
        res.status(400).json({ success: false, message: 'Invalid facility registration', errors: parsed.error.flatten() });
        return;
      }
      const placeId = (req as ResolvedPlaceRequest).resolvedPlaceId;
      if (!placeId) {
        res.status(400).json({ success: false, message: 'placeId or resolvable lng/lat is required' });
        return;
      }
      const facility = await healthFacilities.register({ ...parsed.data, placeId }, actorOf(req));
      res.status(201).json({ success: true, data: facility });
    },
  );

  // List within a scope (district/region) — perm health.facility.read, checked against that scope.
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
      const rows = await healthFacilities.listByScope(scope, {
        facilityType: str(req.query.facilityType),
        status: str(req.query.status),
      });
      res.json({ success: true, count: rows.length, data: rows });
    },
  );

  router.get(
    '/:id',
    requirePermission(rbac, READ_PERM, (req) => healthFacilities.facilityPlacePath(String(req.params.id))),
    async (req, res) => {
      const facility = await healthFacilities.getFacility(String(req.params.id));
      if (!facility) {
        res.status(404).json({ success: false, message: 'Not found' });
        return;
      }
      res.json({ success: true, data: facility });
    },
  );

  router.patch(
    '/:id',
    requirePermission(rbac, MANAGE_PERM, (req) => healthFacilities.facilityPlacePath(String(req.params.id))),
    async (req, res) => {
      const parsed = updateSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ success: false, message: 'Invalid update', errors: parsed.error.flatten() });
        return;
      }
      try {
        const facility = await healthFacilities.update(String(req.params.id), parsed.data, actorOf(req));
        res.json({ success: true, data: facility });
      } catch (err) {
        res.status(404).json({ success: false, message: (err as Error).message });
      }
    },
  );

  // File a new live capacity report — perm health.facility.manage, scoped to the facility's place.
  router.post(
    '/:id/capacity',
    requirePermission(rbac, MANAGE_PERM, (req) => healthFacilities.facilityPlacePath(String(req.params.id))),
    async (req, res) => {
      const parsed = capacityReportSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ success: false, message: 'Invalid capacity report', errors: parsed.error.flatten() });
        return;
      }
      const facility = await healthFacilities.getFacility(String(req.params.id));
      if (!facility) {
        res.status(404).json({ success: false, message: 'Not found' });
        return;
      }
      const report = await healthFacilities.reportCapacity(String(req.params.id), parsed.data, actorOf(req));
      res.status(201).json({ success: true, data: report });
    },
  );

  // Latest capacity report — perm health.facility.read, scoped. A facility with
  // zero reports is a valid state (200 {data: null}), not an error; only an
  // unknown facility id 404s.
  router.get(
    '/:id/capacity',
    requirePermission(rbac, READ_PERM, (req) => healthFacilities.facilityPlacePath(String(req.params.id))),
    async (req, res) => {
      const facility = await healthFacilities.getFacility(String(req.params.id));
      if (!facility) {
        res.status(404).json({ success: false, message: 'Not found' });
        return;
      }
      const report = await healthFacilities.getCapacity(String(req.params.id));
      res.json({ success: true, data: report });
    },
  );

  return router;
}
