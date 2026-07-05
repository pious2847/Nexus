/**
 * Vulnerable-persons registry endpoints, mounted at /api/v1/vulnerable-persons.
 * Sensitive PII: every route requires authentication + a geo-scoped permission
 * (no route ever lists "everyone nationally" — GET / requires an explicit
 * `scope` place id and is permission-checked against that specific place).
 */
import { Router, type Request, type RequestHandler, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import type { CoreServices } from '../../core/http/container';
import { requirePermission } from '../../core/rbac/rbac.middleware';

const { authenticate } = require('../../middleware/auth') as { authenticate: RequestHandler };

const CATEGORIES = ['elderly', 'disabled', 'pregnant', 'chronic_illness', 'bedridden', 'unaccompanied_minor', 'other'] as const;
const MOBILITY = ['independent', 'needs_assistance', 'wheelchair', 'bedridden'] as const;
const CONSENT = ['pending', 'given', 'guardian_given', 'declined'] as const;
const STATUS = ['active', 'evacuated', 'deceased', 'withdrawn'] as const;

const registerSchema = z.object({
  placeId: z.string().uuid().optional(),
  lng: z.number().min(-180).max(180).optional(),
  lat: z.number().min(-90).max(90).optional(),
  fullName: z.string().min(2).max(200),
  category: z.enum(CATEGORIES),
  mobilityLevel: z.enum(MOBILITY).default('needs_assistance'),
  householdContactPhone: z.string().min(8).max(20).optional(),
  householdSize: z.number().int().min(0).max(50).optional(),
  specialNeeds: z.string().max(1000).optional(),
  consentStatus: z.enum(CONSENT),
  consentBy: z.enum(['self', 'guardian', 'reporter_observed']).optional(),
});
const statusSchema = z.object({ status: z.enum(STATUS) });
const consentSchema = z.object({ consentStatus: z.enum(CONSENT), consentBy: z.enum(['self', 'guardian', 'reporter_observed']).optional() });

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const actorOf = (req: Request): string => (req as Request & { user?: { id: string } }).user?.id ?? '';

/** Request-scoped storage for the place resolved from body.placeId/lng/lat (register route). */
interface ResolvedPlaceRequest extends Request {
  resolvedPlaceId?: string | null;
}

export function buildVulnerablePersonsRouter({ vulnerablePersons, geography, rbac }: CoreServices): Router {
  const router = Router();
  router.use(authenticate);

  // Resolve the target place ONCE (from placeId, or lng/lat via reverse geocode) so
  // both the permission check and the handler use the same value.
  const resolveTargetPlace = async (req: ResolvedPlaceRequest, _res: Response, next: NextFunction) => {
    const body = req.body as { placeId?: unknown; lng?: unknown; lat?: unknown };
    const placeId = typeof body.placeId === 'string' ? body.placeId : undefined;
    const lng = typeof body.lng === 'number' ? body.lng : undefined;
    const lat = typeof body.lat === 'number' ? body.lat : undefined;
    req.resolvedPlaceId = placeId ?? (await vulnerablePersons.resolvePlace(lng, lat));
    next();
  };

  router.post(
    '/',
    resolveTargetPlace,
    requirePermission(rbac, 'vulnerable.create', async (req) => {
      const placeId = (req as ResolvedPlaceRequest).resolvedPlaceId;
      if (!placeId) return null;
      return (await geography.getById(placeId))?.path ?? null;
    }),
    async (req, res) => {
      const parsed = registerSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ success: false, message: 'Invalid registration', errors: parsed.error.flatten() });
        return;
      }
      const placeId = (req as ResolvedPlaceRequest).resolvedPlaceId;
      if (!placeId) {
        res.status(400).json({ success: false, message: 'placeId or resolvable lng/lat is required' });
        return;
      }
      const person = await vulnerablePersons.register({ ...parsed.data, placeId }, actorOf(req));
      res.status(201).json({ success: true, data: person });
    },
  );

  // List within a scope (district/region) — perm vulnerable.read, checked against that scope.
  router.get(
    '/',
    requirePermission(rbac, 'vulnerable.read', async (req) => {
      const scope = str(req.query.scope);
      return scope ? (await geography.getById(scope))?.path ?? null : null;
    }),
    async (req, res) => {
      const scope = str(req.query.scope);
      if (!scope) {
        res.status(400).json({ success: false, message: 'scope (a place id) query param is required' });
        return;
      }
      const rows = await vulnerablePersons.listByScope(scope, {
        status: str(req.query.status),
        category: str(req.query.category),
        prioritySort: req.query.sort === 'priority',
      });
      res.json({ success: true, count: rows.length, data: rows });
    },
  );

  router.get(
    '/:id',
    requirePermission(rbac, 'vulnerable.read', (req) => vulnerablePersons.personPlacePath(String(req.params.id))),
    async (req, res) => {
      const person = await vulnerablePersons.getPerson(String(req.params.id));
      if (!person) {
        res.status(404).json({ success: false, message: 'Not found' });
        return;
      }
      res.json({ success: true, data: person });
    },
  );

  router.patch(
    '/:id/status',
    requirePermission(rbac, 'vulnerable.manage', (req) => vulnerablePersons.personPlacePath(String(req.params.id))),
    async (req, res) => {
      const parsed = statusSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ success: false, message: 'valid status required' });
        return;
      }
      try {
        const person = await vulnerablePersons.updateStatus(String(req.params.id), parsed.data.status, actorOf(req));
        res.json({ success: true, data: person });
      } catch (err) {
        res.status(404).json({ success: false, message: (err as Error).message });
      }
    },
  );

  router.patch(
    '/:id/consent',
    requirePermission(rbac, 'vulnerable.manage', (req) => vulnerablePersons.personPlacePath(String(req.params.id))),
    async (req, res) => {
      const parsed = consentSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ success: false, message: 'valid consentStatus required' });
        return;
      }
      try {
        const person = await vulnerablePersons.updateConsent(String(req.params.id), parsed.data.consentStatus, parsed.data.consentBy ?? null, actorOf(req));
        res.json({ success: true, data: person });
      } catch (err) {
        res.status(404).json({ success: false, message: (err as Error).message });
      }
    },
  );

  return router;
}
