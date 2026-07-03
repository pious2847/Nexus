/**
 * Alert endpoints, mounted at /api/v1/alerts. Drafting requires a base publish
 * permission; publishing enforces tiered authority *inside* the service (the
 * required permission depends on the alert's severity).
 */
import { Router, type Request, type RequestHandler } from 'express';
import { z } from 'zod';
import type { CoreServices } from '../../core/http/container';
import { requirePermission } from '../../core/rbac/rbac.middleware';
import { PublishForbiddenError } from './alerts.service';

const { authenticate } = require('../../middleware/auth') as { authenticate: RequestHandler };

const draftSchema = z.object({
  eventId: z.string().uuid(),
  headline: z.string().max(200).optional(),
  instruction: z.string().max(500).optional(),
});
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const actorOf = (req: Request): string => (req as Request & { user?: { id: string } }).user?.id ?? '';

export function buildAlertsRouter({ alerts, rbac }: CoreServices): Router {
  const router = Router();

  router.get('/', async (req, res) => {
    const data = await alerts.listAlerts({ status: str(req.query.status), limit: req.query.limit ? Number(req.query.limit) : undefined });
    res.json({ success: true, count: data.length, data });
  });

  router.get('/:id', async (req, res) => {
    const alert = await alerts.getAlert(String(req.params.id));
    if (!alert) {
      res.status(404).json({ success: false, message: 'Alert not found' });
      return;
    }
    res.json({ success: true, data: { ...alert, cap: alerts.toCap(alert) } });
  });

  // Draft from a hazard event — requires at least advisory publish rights (geo-scoped later).
  router.post('/from-event', authenticate, requirePermission(rbac, 'alert.publish.advisory'), async (req, res) => {
    const parsed = draftSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, message: 'eventId required' });
      return;
    }
    try {
      const alert = await alerts.draftFromEvent(parsed.data.eventId, actorOf(req), {
        headline: parsed.data.headline,
        instruction: parsed.data.instruction,
      });
      res.status(201).json({ success: true, data: alert });
    } catch (err) {
      res.status(404).json({ success: false, message: (err as Error).message });
    }
  });

  // Publish — tiered authority enforced in the service (by severity + area).
  router.post('/:id/publish', authenticate, async (req, res) => {
    try {
      const alert = await alerts.publish(String(req.params.id), actorOf(req));
      res.json({ success: true, message: `Published to ${alert.recipients} subscriber(s)`, data: alert });
    } catch (err) {
      if (err instanceof PublishForbiddenError) {
        res.status(403).json({ success: false, message: err.message });
        return;
      }
      res.status(400).json({ success: false, message: (err as Error).message });
    }
  });

  return router;
}
