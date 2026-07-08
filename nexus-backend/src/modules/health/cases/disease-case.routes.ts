/**
 * Disease case reporting endpoints, mounted at /api/v1/health-cases.
 * Epi-aggregate data (no patient identifiers). Mirrors vulnerable.routes.ts:
 * GET / requires an explicit `scope` place id and is permission-checked
 * against that specific place (no "all cases nationally" endpoint here either
 * — even though this isn't PII, an unscoped feed would be an easy DoS/scrape
 * target and scoping keeps the RBAC model consistent across modules).
 */
import { Router, type Request, type RequestHandler, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import type { CoreServices } from '../../../core/http/container';
import { requirePermission } from '../../../core/rbac/rbac.middleware';
import type { DiseaseCaseService } from './disease-case.service';

// `CoreServices` doesn't (yet) declare `diseaseCases` — that field is added by the
// orchestrating session when it wires this module into container.ts (see README).
// This local extension keeps the router's signature matching the eventual shape
// (`buildDiseaseCaseRouter(services: CoreServices)`) without editing container.ts.
type Services = CoreServices & { diseaseCases: DiseaseCaseService };

const { authenticate } = require('../../../middleware/auth') as { authenticate: RequestHandler };

const CASE_STATUS = ['suspected', 'probable', 'confirmed', 'ruled_out'] as const;
const CASE_SOURCE = ['facility', 'field_worker', 'citizen'] as const;
const AGE_GROUP = ['0-4', '5-14', '15-49', '50+', 'unknown'] as const;
const SEX = ['M', 'F', 'unknown'] as const;

const reportSchema = z.object({
  placeId: z.string().uuid().optional(),
  lng: z.number().min(-180).max(180).optional(),
  lat: z.number().min(-90).max(90).optional(),
  // Not validated against the disease_types FK here (that's a DB-layer 500 on a
  // bad code) — just a reasonably permissive shape check, normalized to lowercase.
  diseaseCode: z
    .string()
    .min(2)
    .max(50)
    .regex(/^[a-z0-9_-]+$/i, 'diseaseCode must be letters, digits, "-" or "_"')
    .transform((v) => v.toLowerCase()),
  caseStatus: z.enum(CASE_STATUS).default('suspected'),
  source: z.enum(CASE_SOURCE).default('facility'),
  ageGroup: z.enum(AGE_GROUP).optional(),
  sex: z.enum(SEX).optional(),
  onsetDate: z.string().date().optional(),
  notes: z.string().max(1000).optional(),
  facilityId: z.string().uuid().optional(),
});

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const actorOf = (req: Request): string => (req as Request & { user?: { id: string } }).user?.id ?? '';

/** Request-scoped storage for the place resolved from body.placeId/lng/lat (report route). */
interface ResolvedPlaceRequest extends Request {
  resolvedPlaceId?: string | null;
}

export function buildDiseaseCaseRouter({ diseaseCases, geography, rbac }: Services): Router {
  const router = Router();
  router.use(authenticate);

  // Resolve the target place ONCE (from placeId, or lng/lat via reverse geocode) so
  // both the permission check and the handler use the same value.
  const resolveTargetPlace = async (req: ResolvedPlaceRequest, _res: Response, next: NextFunction) => {
    const body = req.body as { placeId?: unknown; lng?: unknown; lat?: unknown };
    const placeId = typeof body.placeId === 'string' ? body.placeId : undefined;
    const lng = typeof body.lng === 'number' ? body.lng : undefined;
    const lat = typeof body.lat === 'number' ? body.lat : undefined;
    req.resolvedPlaceId = placeId ?? (await diseaseCases.resolvePlace(lng, lat));
    next();
  };

  router.post(
    '/',
    resolveTargetPlace,
    requirePermission(rbac, 'health.case.create', async (req) => {
      const placeId = (req as ResolvedPlaceRequest).resolvedPlaceId;
      if (!placeId) return null;
      return (await geography.getById(placeId))?.path ?? null;
    }),
    async (req, res) => {
      const parsed = reportSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ success: false, message: 'Invalid case report', errors: parsed.error.flatten() });
        return;
      }
      const placeId = (req as ResolvedPlaceRequest).resolvedPlaceId;
      if (!placeId) {
        res.status(400).json({ success: false, message: 'placeId or resolvable lng/lat is required' });
        return;
      }
      try {
        const diseaseCase = await diseaseCases.report({ ...parsed.data, placeId }, actorOf(req));
        res.status(201).json({ success: true, data: diseaseCase });
      } catch (err) {
        // Most likely an unknown disease_code (FK violation) — the DB is the source of truth.
        res.status(400).json({ success: false, message: (err as Error).message });
      }
    },
  );

  // List within a scope (district/region) — perm health.case.read, checked against that scope.
  router.get(
    '/',
    requirePermission(rbac, 'health.case.read', async (req) => {
      const scope = str(req.query.scope);
      return scope ? (await geography.getById(scope))?.path ?? null : null;
    }),
    async (req, res) => {
      const scope = str(req.query.scope);
      if (!scope) {
        res.status(400).json({ success: false, message: 'scope (a place id) query param is required' });
        return;
      }
      const rows = await diseaseCases.listByScope(scope, {
        diseaseCode: str(req.query.diseaseCode),
        caseStatus: str(req.query.caseStatus),
        from: str(req.query.from),
        to: str(req.query.to),
      });
      res.json({ success: true, count: rows.length, data: rows });
    },
  );

  router.get(
    '/:id',
    requirePermission(rbac, 'health.case.read', (req) => diseaseCases.casePlacePath(String(req.params.id))),
    async (req, res) => {
      const diseaseCase = await diseaseCases.getCase(String(req.params.id));
      if (!diseaseCase) {
        res.status(404).json({ success: false, message: 'Not found' });
        return;
      }
      res.json({ success: true, data: diseaseCase });
    },
  );

  return router;
}
