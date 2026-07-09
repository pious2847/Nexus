/**
 * Missing persons & family reunification endpoints, mounted at
 * /api/v1/missing-persons (spec 02 N3). Mirrors shelter.routes.ts's shape
 * (resolveTargetPlace + geo-scoped RBAC) closely, plus a candidate-match
 * lookup route. Sensitive PII — unlike shelters, every route here requires
 * auth (no public lookup).
 */
import { Router, type Request, type RequestHandler, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import type { Permission } from '@nexus/shared';
import type { CoreServices } from '../../core/http/container';
import { requirePermission } from '../../core/rbac/rbac.middleware';
import type { MissingPersonsService } from './missing.service';

const { authenticate } = require('../../middleware/auth') as { authenticate: RequestHandler };

const STATUSES = ['missing', 'found', 'reunified', 'closed'] as const;

const REPORT_PERM: Permission = 'missing.report';
const READ_PERM: Permission = 'missing.read';
const MANAGE_PERM: Permission = 'missing.manage';

const reportSchema = z.object({
  placeId: z.string().uuid().optional(),
  lng: z.number().min(-180).max(180).optional(),
  lat: z.number().min(-90).max(90).optional(),
  fullName: z.string().min(2).max(200),
  ageEstimate: z.string().max(50).optional(),
  sex: z.string().max(20).optional(),
  distinguishingFeatures: z.string().max(2000).optional(),
  photoUrl: z.string().max(2000).optional(),
  lastSeenAt: z.coerce.date().optional(),
  reporterPhone: z.string().min(8).max(20),
  relationshipToMissing: z.string().max(100).optional(),
  notes: z.string().max(2000).optional(),
});

const updateSchema = z.object({
  status: z.enum(STATUSES).optional(),
  matchedCheckinId: z.string().uuid().nullable().optional(),
  matchedVulnerablePersonId: z.string().uuid().nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const actorOf = (req: Request): string => (req as Request & { user?: { id: string } }).user?.id ?? '';

/** Request-scoped storage for the place resolved from body.placeId/lng/lat (report route). */
interface ResolvedPlaceRequest extends Request {
  resolvedPlaceId?: string | null;
}

/**
 * Dependencies this router needs. Typed as a subset of `CoreServices` plus
 * the not-yet-wired `missingPersons` service, so this file type-checks
 * standalone before the orchestrator adds a `missingPersons: MissingPersonsService`
 * field to `CoreServices` (see README "Wiring needed").
 */
type MissingPersonsRouterDeps = Pick<CoreServices, 'geography' | 'rbac'> & { missingPersons: MissingPersonsService };

export function buildMissingPersonsRouter({ missingPersons, geography, rbac }: MissingPersonsRouterDeps): Router {
  const router = Router();

  router.use(authenticate);

  // Resolve the target place ONCE (from placeId, or lng/lat via reverse geocode) so
  // both the permission check and the handler use the same value.
  const resolveTargetPlace = async (req: ResolvedPlaceRequest, _res: Response, next: NextFunction) => {
    const body = req.body as { placeId?: unknown; lng?: unknown; lat?: unknown };
    const placeId = typeof body.placeId === 'string' ? body.placeId : undefined;
    const lng = typeof body.lng === 'number' ? body.lng : undefined;
    const lat = typeof body.lat === 'number' ? body.lat : undefined;
    req.resolvedPlaceId = placeId ?? (await missingPersons.resolvePlace(lng, lat));
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
        res.status(400).json({ success: false, message: 'Invalid missing-person report', errors: parsed.error.flatten() });
        return;
      }
      const placeId = (req as ResolvedPlaceRequest).resolvedPlaceId;
      if (!placeId) {
        res.status(400).json({ success: false, message: 'placeId or resolvable lng/lat is required' });
        return;
      }
      const { lng, lat, ...rest } = parsed.data;
      const record = await missingPersons.report(
        { ...rest, placeId, lastSeenLng: lng ?? null, lastSeenLat: lat ?? null },
        actorOf(req),
      );
      res.status(201).json({ success: true, data: record });
    },
  );

  // List within a scope (district/region) — perm missing.read, checked against that scope.
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
      const rows = await missingPersons.listByScope(scope, { status: str(req.query.status) });
      res.json({ success: true, count: rows.length, data: rows });
    },
  );

  router.get(
    '/:id',
    requirePermission(rbac, READ_PERM, (req) => missingPersons.missingPersonPlacePath(String(req.params.id))),
    async (req, res) => {
      const record = await missingPersons.getMissingPerson(String(req.params.id));
      if (!record) {
        res.status(404).json({ success: false, message: 'Not found' });
        return;
      }
      res.json({ success: true, data: record });
    },
  );

  router.get(
    '/:id/matches',
    requirePermission(rbac, READ_PERM, (req) => missingPersons.missingPersonPlacePath(String(req.params.id))),
    async (req, res) => {
      try {
        const result = await missingPersons.findMatches(String(req.params.id));
        res.json({ success: true, data: result });
      } catch (err) {
        res.status(404).json({ success: false, message: (err as Error).message });
      }
    },
  );

  router.patch(
    '/:id',
    requirePermission(rbac, MANAGE_PERM, (req) => missingPersons.missingPersonPlacePath(String(req.params.id))),
    async (req, res) => {
      const parsed = updateSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ success: false, message: 'Invalid update', errors: parsed.error.flatten() });
        return;
      }
      try {
        const record = await missingPersons.updateStatus(String(req.params.id), parsed.data, actorOf(req));
        res.json({ success: true, data: record });
      } catch (err) {
        res.status(404).json({ success: false, message: (err as Error).message });
      }
    },
  );

  return router;
}
