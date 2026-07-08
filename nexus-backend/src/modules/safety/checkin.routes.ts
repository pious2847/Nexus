/**
 * "I'm Safe" check-in endpoints, mounted at /api/v1/safety-checkins (spec 02 N1).
 * The primary intake channel is SMS (modules/safety/sms) — these HTTP routes
 * are for a future PWA tap and for officers viewing the aggregated picture.
 */
import { Router, type Request, type RequestHandler, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import type { CoreServices } from '../../core/http/container';
import { requirePermission } from '../../core/rbac/rbac.middleware';

const { authenticate } = require('../../middleware/auth') as { authenticate: RequestHandler };

const STATUS = ['safe', 'need_help', 'injured'] as const;

const checkInSchema = z.object({
  placeId: z.string().uuid().optional(),
  lng: z.number().min(-180).max(180).optional(),
  lat: z.number().min(-90).max(90).optional(),
  status: z.enum(STATUS),
  subjectName: z.string().min(2).max(200).optional(),
  notes: z.string().max(500).optional(),
});

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const actorOf = (req: Request): string => (req as Request & { user?: { id: string } }).user?.id ?? '';

interface ResolvedPlaceRequest extends Request {
  resolvedPlaceId?: string | null;
}

export function buildSafetyCheckinRouter({ safetyCheckins, geography, hazards, rbac }: CoreServices): Router {
  const router = Router();
  router.use(authenticate);

  const resolveTargetPlace = async (req: ResolvedPlaceRequest, _res: Response, next: NextFunction) => {
    const body = req.body as { placeId?: unknown; lng?: unknown; lat?: unknown };
    const placeId = typeof body.placeId === 'string' ? body.placeId : undefined;
    const lng = typeof body.lng === 'number' ? body.lng : undefined;
    const lat = typeof body.lat === 'number' ? body.lat : undefined;
    req.resolvedPlaceId = placeId ?? (await safetyCheckins.resolvePlace(lng, lat));
    next();
  };

  router.post(
    '/',
    resolveTargetPlace,
    requirePermission(rbac, 'safety.checkin.create', async (req) => {
      const placeId = (req as ResolvedPlaceRequest).resolvedPlaceId;
      if (!placeId) return null;
      return (await geography.getById(placeId))?.path ?? null;
    }),
    async (req, res) => {
      const parsed = checkInSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ success: false, message: 'Invalid check-in', errors: parsed.error.flatten() });
        return;
      }
      const placeId = (req as ResolvedPlaceRequest).resolvedPlaceId;
      if (!placeId) {
        res.status(400).json({ success: false, message: 'placeId or resolvable lng/lat is required' });
        return;
      }
      const checkin = await safetyCheckins.checkIn(
        { placeId, status: parsed.data.status, subjectName: parsed.data.subjectName ?? null, notes: parsed.data.notes ?? null, source: 'pwa' },
        actorOf(req),
      );
      res.status(201).json({ success: true, data: checkin });
    },
  );

  // Aggregated "who's unaccounted for" view for a hazard event.
  router.get(
    '/event/:eventId/summary',
    requirePermission(rbac, 'safety.checkin.read', (req) => hazards.eventPlacePath(String(req.params.eventId))),
    async (req, res) => {
      const summary = await safetyCheckins.summaryByEvent(String(req.params.eventId));
      res.json({ success: true, data: summary });
    },
  );

  router.get(
    '/event/:eventId',
    requirePermission(rbac, 'safety.checkin.read', (req) => hazards.eventPlacePath(String(req.params.eventId))),
    async (req, res) => {
      const rows = await safetyCheckins.listByEvent(String(req.params.eventId));
      res.json({ success: true, count: rows.length, data: rows });
    },
  );

  // District/region-wide view — perm safety.checkin.read, checked against that scope.
  router.get(
    '/',
    requirePermission(rbac, 'safety.checkin.read', async (req) => {
      const scope = str(req.query.scope);
      return scope ? (await geography.getById(scope))?.path ?? null : null;
    }),
    async (req, res) => {
      const scope = str(req.query.scope);
      if (!scope) {
        res.status(400).json({ success: false, message: 'scope (a place id) query param is required' });
        return;
      }
      const rows = await safetyCheckins.listByScope(scope, { status: str(req.query.status) });
      res.json({ success: true, count: rows.length, data: rows });
    },
  );

  return router;
}
