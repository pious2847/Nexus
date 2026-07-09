/**
 * Hazard endpoints, mounted at /api/v1/hazards.
 * Reads are public; create/transition require the relevant permission,
 * geography-scoped to the target place (RBAC).
 */
import { Router, type Request, type RequestHandler } from 'express';
import { z } from 'zod';
import { CAP_SEVERITIES, HAZARD_EVENT_STATES, HAZARD_TYPES } from '@nexus/shared';
import type { CoreServices } from '../../core/http/container';
import { requirePermission } from '../../core/rbac/rbac.middleware';

// Legacy JWT auth middleware (CommonJS) sets req.user.
const { authenticate } = require('../../middleware/auth') as { authenticate: RequestHandler };

const createSchema = z.object({
  hazardType: z.enum(HAZARD_TYPES),
  placeId: z.string().uuid().optional(),
  title: z.string().min(3),
  description: z.string().optional(),
  state: z.enum(HAZARD_EVENT_STATES).optional(),
  severity: z.enum(CAP_SEVERITIES).optional(),
  urgency: z.string().optional(),
  certainty: z.string().optional(),
  confidence: z.number().optional(),
});
const transitionSchema = z.object({ toState: z.enum(HAZARD_EVENT_STATES), reason: z.string().optional() });
const hazardTypePatchSchema = z.object({
  label: z.string().min(1).optional(),
  category: z.string().min(1).optional(),
  thresholds: z.record(z.string(), z.unknown()).optional(),
  leadTimeHours: z.number().int().min(0).nullable().optional(),
  enabled: z.boolean().optional(),
});

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const actorOf = (req: Request): string | null => (req as Request & { user?: { id: string } }).user?.id ?? null;

export function buildHazardsRouter({ hazards, geography, rbac }: CoreServices): Router {
  const router = Router();

  router.get('/types', async (_req, res) => {
    res.json({ success: true, data: await hazards.listHazardTypes() });
  });

  // Runtime threshold/config edit (Module L) — previously only editable via the
  // seed-hazard-types.ts CLI. National-scoped (no resolveTargetPath — thresholds
  // aren't a per-place resource), config.manage only (super_admin by default).
  router.patch('/types/:code', authenticate, requirePermission(rbac, 'config.manage'), async (req, res) => {
    const parsed = hazardTypePatchSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, message: 'Invalid hazard-type patch', errors: parsed.error.flatten() });
      return;
    }
    try {
      const updated = await hazards.updateHazardType(String(req.params.code), parsed.data, actorOf(req));
      res.json({ success: true, data: updated });
    } catch (err) {
      res.status(404).json({ success: false, message: (err as Error).message });
    }
  });

  router.get('/events', async (req, res) => {
    const q = req.query;
    const data = await hazards.listEvents({
      hazardType: str(q.type),
      placeId: str(q.place),
      state: str(q.state),
      severity: str(q.severity),
      limit: q.limit ? Number(q.limit) : undefined,
    });
    res.json({ success: true, count: data.length, data });
  });

  router.get('/events/:id', async (req, res) => {
    const event = await hazards.getEvent(req.params.id);
    if (!event) {
      res.status(404).json({ success: false, message: 'Hazard event not found' });
      return;
    }
    const transitions = await hazards.eventTransitions(req.params.id);
    res.json({ success: true, data: { ...event, transitions } });
  });

  router.post(
    '/events',
    authenticate,
    requirePermission(rbac, 'hazard.event.create', async (req) => {
      const placeId = (req.body as { placeId?: string })?.placeId;
      return placeId ? ((await geography.getById(placeId))?.path ?? null) : null;
    }),
    async (req, res) => {
      const parsed = createSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ success: false, message: 'Invalid event', errors: parsed.error.flatten() });
        return;
      }
      const event = await hazards.raiseEvent(parsed.data, actorOf(req));
      res.status(201).json({ success: true, data: event });
    },
  );

  router.post(
    '/events/:id/transition',
    authenticate,
    requirePermission(rbac, 'hazard.event.transition', (req) => hazards.eventPlacePath(String(req.params.id))),
    async (req, res) => {
      const parsed = transitionSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ success: false, message: 'valid toState required' });
        return;
      }
      try {
        const event = await hazards.transition(String(req.params.id), parsed.data.toState, actorOf(req), parsed.data.reason);
        res.json({ success: true, data: event });
      } catch (err) {
        res.status(409).json({ success: false, message: (err as Error).message });
      }
    },
  );

  return router;
}
