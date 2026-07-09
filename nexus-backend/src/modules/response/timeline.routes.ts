/**
 * Response timeline / after-action endpoint, mounted at /api/v1/response-timeline
 * (Module M §5). Gated by hazard.event.read (same permission as viewing the
 * hazard event itself) scoped via the event's place — reuses HazardService's
 * eventPlacePath rather than introducing a new permission for what is really
 * just another view onto an existing hazard event.
 */
import { Router, type RequestHandler } from 'express';
import type { CoreServices } from '../../core/http/container';
import { requirePermission } from '../../core/rbac/rbac.middleware';

const { authenticate } = require('../../middleware/auth') as { authenticate: RequestHandler };

export function buildResponseTimelineRouter({ responseTimeline, hazards, rbac }: CoreServices): Router {
  const router = Router();
  router.use(authenticate);

  router.get(
    '/:hazardEventId',
    requirePermission(rbac, 'hazard.event.read', (req) => hazards.eventPlacePath(String(req.params.hazardEventId))),
    async (req, res) => {
      const timeline = await responseTimeline.getTimeline(String(req.params.hazardEventId));
      res.json({ success: true, count: timeline.length, data: timeline });
    },
  );

  return router;
}
