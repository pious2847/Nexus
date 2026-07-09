/**
 * Volunteer roster endpoints, intended mount: /api/v1/volunteers. Follows the
 * `health-facility.routes.ts` shape: a `resolveTargetPlace` middleware resolves
 * placeId/lng/lat once for both the RBAC check and the handler.
 */
import { Router, type Request, type RequestHandler, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import type { CoreServices } from '../../../core/http/container';
import { requirePermission } from '../../../core/rbac/rbac.middleware';
import type { VolunteerService } from './volunteer.service';
import type { DispatchService } from '../dispatch/dispatch.service';

const { authenticate } = require('../../../middleware/auth') as { authenticate: RequestHandler };

const registerSchema = z.object({
  userId: z.string().uuid().optional(),
  name: z.string().min(2).max(200),
  phone: z.string().min(8).max(20).optional(),
  placeId: z.string().uuid().optional(),
  lng: z.number().min(-180).max(180).optional(),
  lat: z.number().min(-90).max(90).optional(),
  skills: z.array(z.string()).optional(),
});

const AVAILABILITY = ['available', 'unavailable', 'deployed'] as const;
const updateSchema = z.object({
  name: z.string().min(2).max(200).optional(),
  phone: z.string().min(8).max(20).optional(),
  skills: z.array(z.string()).optional(),
  availability: z.enum(AVAILABILITY).optional(),
});

const assignSchema = z.object({ taskId: z.string().uuid() });

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const actorOf = (req: Request): string | null => (req as Request & { user?: { id: string } }).user?.id ?? null;

interface ResolvedPlaceRequest extends Request {
  resolvedPlaceId?: string | null;
}

/**
 * Dependencies this router needs. Typed as a subset of `CoreServices` plus the
 * not-yet-wired `volunteers`/`dispatch` services (the latter only used to
 * resolve a task's place for `GET /match`), so this file type-checks
 * standalone before the orchestrator wires `CoreServices` (see README).
 */
type VolunteerRouterDeps = Pick<CoreServices, 'geography' | 'rbac'> & {
  volunteers: VolunteerService;
  dispatch: DispatchService;
};

export function buildVolunteerRouter({ volunteers, dispatch, geography, rbac }: VolunteerRouterDeps): Router {
  const router = Router();
  router.use(authenticate);

  const resolveTargetPlace = async (req: ResolvedPlaceRequest, _res: Response, next: NextFunction) => {
    const body = req.body as { placeId?: unknown; lng?: unknown; lat?: unknown };
    const placeId = typeof body.placeId === 'string' ? body.placeId : undefined;
    const lng = typeof body.lng === 'number' ? body.lng : undefined;
    const lat = typeof body.lat === 'number' ? body.lat : undefined;
    req.resolvedPlaceId = placeId ?? (await volunteers.resolvePlace(lng, lat));
    next();
  };

  router.post(
    '/',
    resolveTargetPlace,
    requirePermission(rbac, 'volunteer.create', async (req) => {
      const placeId = (req as ResolvedPlaceRequest).resolvedPlaceId;
      return placeId ? (await geography.getById(placeId))?.path ?? null : null;
    }),
    async (req, res) => {
      const parsed = registerSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ success: false, message: 'Invalid volunteer registration', errors: parsed.error.flatten() });
        return;
      }
      const placeId = (req as ResolvedPlaceRequest).resolvedPlaceId;
      if (!placeId) {
        res.status(400).json({ success: false, message: 'placeId or resolvable lng/lat is required' });
        return;
      }
      const { lng: _lng, lat: _lat, placeId: _placeId, ...rest } = parsed.data;
      const volunteer = await volunteers.register({ ...rest, placeId }, actorOf(req));
      res.status(201).json({ success: true, data: volunteer });
    },
  );

  router.get(
    '/',
    requirePermission(rbac, 'volunteer.read', async (req) => {
      const scope = str(req.query.scope);
      return scope ? (await geography.getById(scope))?.path ?? null : null;
    }),
    async (req, res) => {
      const scope = str(req.query.scope);
      if (!scope) {
        res.status(400).json({ success: false, message: 'scope (a place id) query param is required' });
        return;
      }
      const rows = await volunteers.listByScope(scope, {
        availability: str(req.query.availability),
        skill: str(req.query.skill),
      });
      res.json({ success: true, count: rows.length, data: rows });
    },
  );

  // Match available volunteers to a dispatch task by place proximity + skill.
  // Mounted before '/:id' so 'match' is never captured as an :id param.
  router.get(
    '/match',
    requirePermission(rbac, 'volunteer.read', async (req) => {
      const taskId = str(req.query.taskId);
      return taskId ? await dispatch.taskPlacePath(taskId) : null;
    }),
    async (req, res) => {
      const taskId = str(req.query.taskId);
      if (!taskId) {
        res.status(400).json({ success: false, message: 'taskId query param is required' });
        return;
      }
      const placePath = await dispatch.taskPlacePath(taskId);
      if (!placePath) {
        res.status(404).json({ success: false, message: 'Task not found or has no resolvable place' });
        return;
      }
      const limit = req.query.limit ? Number(req.query.limit) : undefined;
      const rows = await volunteers.matchForTask(placePath, str(req.query.skill), limit);
      res.json({ success: true, count: rows.length, data: rows });
    },
  );

  router.get(
    '/:id',
    requirePermission(rbac, 'volunteer.read', (req) => volunteers.volunteerPlacePath(String(req.params.id))),
    async (req, res) => {
      const volunteer = await volunteers.getVolunteer(String(req.params.id));
      if (!volunteer) {
        res.status(404).json({ success: false, message: 'Volunteer not found' });
        return;
      }
      res.json({ success: true, data: volunteer });
    },
  );

  router.patch(
    '/:id',
    requirePermission(rbac, 'volunteer.manage', (req) => volunteers.volunteerPlacePath(String(req.params.id))),
    async (req, res) => {
      const parsed = updateSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ success: false, message: 'Invalid update', errors: parsed.error.flatten() });
        return;
      }
      try {
        const volunteer = await volunteers.update(String(req.params.id), parsed.data, actorOf(req));
        res.json({ success: true, data: volunteer });
      } catch (err) {
        res.status(404).json({ success: false, message: (err as Error).message });
      }
    },
  );

  router.post(
    '/:id/assign',
    requirePermission(rbac, 'volunteer.manage', (req) => volunteers.volunteerPlacePath(String(req.params.id))),
    async (req, res) => {
      const parsed = assignSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ success: false, message: 'taskId is required' });
        return;
      }
      try {
        const volunteer = await volunteers.assignToTask(String(req.params.id), parsed.data.taskId, actorOf(req));
        res.json({ success: true, data: volunteer });
      } catch (err) {
        res.status(404).json({ success: false, message: (err as Error).message });
      }
    },
  );

  return router;
}
