/**
 * Rapid damage & needs assessment endpoints, mounted at /api/v1/assessments
 * (spec 02 N15). Mirrors shelter.routes.ts's shape (resolveTargetPlace +
 * geo-scoped RBAC) plus a `/sitrep` aggregation route for the auto-rolled-up
 * situation report.
 */
import { Router, type Request, type RequestHandler, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import type { Permission } from '@nexus/shared';
import type { CoreServices } from '../../core/http/container';
import { requirePermission } from '../../core/rbac/rbac.middleware';
import type { AssessmentService } from './assessment.service';

const { authenticate } = require('../../middleware/auth') as { authenticate: RequestHandler };

const CREATE_PERM: Permission = 'assessment.create';
const READ_PERM: Permission = 'assessment.read';

const submitSchema = z.object({
  placeId: z.string().uuid().optional(),
  lng: z.number().min(-180).max(180).optional(),
  lat: z.number().min(-90).max(90).optional(),
  hazardEventId: z.string().uuid().optional(),
  householdsAffected: z.number().int().min(0).optional().default(0),
  personsAffected: z.number().int().min(0).optional().default(0),
  casualties: z.number().int().min(0).optional().default(0),
  injuries: z.number().int().min(0).optional().default(0),
  infrastructureDamage: z.string().max(4000).optional(),
  urgentNeeds: z.array(z.string()).optional(),
  media: z.unknown().optional(),
  notes: z.string().max(4000).optional(),
});

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const actorOf = (req: Request): string => (req as Request & { user?: { id: string } }).user?.id ?? '';

/** Request-scoped storage for the place resolved from body.placeId/lng/lat (submit route). */
interface ResolvedPlaceRequest extends Request {
  resolvedPlaceId?: string | null;
}

/**
 * Dependencies this router needs. Typed as a subset of `CoreServices` plus
 * the not-yet-wired `assessments` service, so this file type-checks
 * standalone before the orchestrator adds an `assessments: AssessmentService`
 * field to `CoreServices` (see README "Wiring needed").
 */
type AssessmentRouterDeps = Pick<CoreServices, 'geography' | 'rbac'> & { assessments: AssessmentService };

export function buildAssessmentRouter({ assessments, geography, rbac }: AssessmentRouterDeps): Router {
  const router = Router();

  router.use(authenticate);

  // Resolve the target place ONCE (from placeId, or lng/lat via reverse geocode) so
  // both the permission check and the handler use the same value.
  const resolveTargetPlace = async (req: ResolvedPlaceRequest, _res: Response, next: NextFunction) => {
    const body = req.body as { placeId?: unknown; lng?: unknown; lat?: unknown };
    const placeId = typeof body.placeId === 'string' ? body.placeId : undefined;
    const lng = typeof body.lng === 'number' ? body.lng : undefined;
    const lat = typeof body.lat === 'number' ? body.lat : undefined;
    req.resolvedPlaceId = placeId ?? (await assessments.resolvePlace(lng, lat));
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
      const parsed = submitSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ success: false, message: 'Invalid assessment submission', errors: parsed.error.flatten() });
        return;
      }
      const placeId = (req as ResolvedPlaceRequest).resolvedPlaceId;
      if (!placeId) {
        res.status(400).json({ success: false, message: 'placeId or resolvable lng/lat is required' });
        return;
      }
      const { placeId: _ignored, lng: _lng, lat: _lat, ...rest } = parsed.data;
      const assessment = await assessments.submit({ ...rest, placeId }, actorOf(req));
      res.status(201).json({ success: true, data: assessment });
    },
  );

  // Situation report — auto-rolled-up aggregation across a scope/hazard event. Registered
  // before `/:id` so the literal segment `sitrep` isn't swallowed by the `:id` param route.
  router.get(
    '/sitrep',
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
      const report = await assessments.situationReport(scope, str(req.query.hazardEventId));
      res.json({ success: true, data: report });
    },
  );

  // List within a scope (district/region) — perm assessment.read, checked against that scope.
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
      const rows = await assessments.listByScope(scope, { hazardEventId: str(req.query.hazardEventId) });
      res.json({ success: true, count: rows.length, data: rows });
    },
  );

  router.get(
    '/:id',
    requirePermission(rbac, READ_PERM, (req) => assessments.assessmentPlacePath(String(req.params.id))),
    async (req, res) => {
      const assessment = await assessments.getAssessment(String(req.params.id));
      if (!assessment) {
        res.status(404).json({ success: false, message: 'Not found' });
        return;
      }
      res.json({ success: true, data: assessment });
    },
  );

  return router;
}
