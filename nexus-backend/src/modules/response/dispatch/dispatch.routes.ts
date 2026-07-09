/**
 * Incident dispatch/tasking endpoints, intended mount: /api/v1/dispatch.
 * Reads require dispatch.read; create requires dispatch.create; assign/
 * transition require dispatch.manage — geography-scoped to the task's place
 * (or, if the task has no place, national-scoped per rbac.ts's null-path rule).
 */
import { Router, type Request, type RequestHandler } from 'express';
import { z } from 'zod';
import type { CoreServices } from '../../../core/http/container';
import { requirePermission } from '../../../core/rbac/rbac.middleware';
import type { DispatchService } from './dispatch.service';

// Legacy JWT auth middleware (CommonJS) sets req.user.
const { authenticate } = require('../../../middleware/auth') as { authenticate: RequestHandler };

const TASK_TYPES = ['rescue', 'assessment', 'distribution', 'repair', 'other'] as const;
const PRIORITIES = ['low', 'normal', 'high', 'critical'] as const;
const STATUSES = ['open', 'assigned', 'in_progress', 'done', 'cancelled'] as const;

const createSchema = z.object({
  hazardEventId: z.string().uuid().optional(),
  placeId: z.string().uuid().optional(),
  lng: z.number().min(-180).max(180).optional(),
  lat: z.number().min(-90).max(90).optional(),
  taskType: z.enum(TASK_TYPES),
  description: z.string().optional(),
  priority: z.enum(PRIORITIES).optional(),
});

const assignSchema = z.object({ assignedTo: z.string().uuid() });
const transitionSchema = z.object({ status: z.enum(STATUSES), note: z.string().optional() });

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const actorOf = (req: Request): string | null => (req as Request & { user?: { id: string } }).user?.id ?? null;

/**
 * Dependencies this router needs. Typed as a subset of `CoreServices` plus the
 * not-yet-wired `dispatch` service, so this file type-checks standalone before
 * the orchestrator adds a `dispatch: DispatchService` field to `CoreServices`
 * (see README "Wiring needed"). Once that field exists, a full `CoreServices`
 * object satisfies this type structurally — no change needed here.
 */
type DispatchRouterDeps = Pick<CoreServices, 'geography' | 'rbac'> & { dispatch: DispatchService };

export function buildDispatchRouter({ dispatch, geography, rbac }: DispatchRouterDeps): Router {
  const router = Router();
  router.use(authenticate);

  router.post(
    '/',
    requirePermission(rbac, 'dispatch.create', async (req) => {
      const placeId = (req.body as { placeId?: string })?.placeId;
      return placeId ? ((await geography.getById(placeId))?.path ?? null) : null;
    }),
    async (req, res) => {
      const parsed = createSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ success: false, message: 'Invalid dispatch task', errors: parsed.error.flatten() });
        return;
      }
      const task = await dispatch.createTask(parsed.data, actorOf(req));
      res.status(201).json({ success: true, data: task });
    },
  );

  router.get(
    '/',
    requirePermission(rbac, 'dispatch.read', async (req) => {
      const scope = str(req.query.scope);
      return scope ? (await geography.getById(scope))?.path ?? null : null;
    }),
    async (req, res) => {
      const scope = str(req.query.scope);
      if (!scope) {
        res.status(400).json({ success: false, message: 'scope (a place id) query param is required' });
        return;
      }
      const rows = await dispatch.listByScope(scope, {
        status: str(req.query.status),
        taskType: str(req.query.taskType),
        hazardEventId: str(req.query.hazardEventId),
      });
      res.json({ success: true, count: rows.length, data: rows });
    },
  );

  router.get(
    '/:id',
    requirePermission(rbac, 'dispatch.read', (req) => dispatch.taskPlacePath(String(req.params.id))),
    async (req, res) => {
      const task = await dispatch.getTask(String(req.params.id));
      if (!task) {
        res.status(404).json({ success: false, message: 'Dispatch task not found' });
        return;
      }
      res.json({ success: true, data: task });
    },
  );

  router.get(
    '/:id/events',
    requirePermission(rbac, 'dispatch.read', (req) => dispatch.taskPlacePath(String(req.params.id))),
    async (req, res) => {
      const events = await dispatch.taskEvents(String(req.params.id));
      res.json({ success: true, count: events.length, data: events });
    },
  );

  router.post(
    '/:id/assign',
    requirePermission(rbac, 'dispatch.manage', (req) => dispatch.taskPlacePath(String(req.params.id))),
    async (req, res) => {
      const parsed = assignSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ success: false, message: 'assignedTo (a user id) is required' });
        return;
      }
      try {
        const task = await dispatch.assign(String(req.params.id), parsed.data.assignedTo, actorOf(req));
        res.json({ success: true, data: task });
      } catch (err) {
        res.status(400).json({ success: false, message: (err as Error).message });
      }
    },
  );

  router.post(
    '/:id/transition',
    requirePermission(rbac, 'dispatch.manage', (req) => dispatch.taskPlacePath(String(req.params.id))),
    async (req, res) => {
      const parsed = transitionSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ success: false, message: 'valid status required' });
        return;
      }
      try {
        const task = await dispatch.transition(String(req.params.id), parsed.data.status, actorOf(req), parsed.data.note);
        res.json({ success: true, data: task });
      } catch (err) {
        res.status(400).json({ success: false, message: (err as Error).message });
      }
    },
  );

  return router;
}
