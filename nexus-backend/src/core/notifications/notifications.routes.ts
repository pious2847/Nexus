/**
 * Citizen-facing notification endpoints, mounted at /api/v1/notifications.
 * All routes require authentication and act on the caller's own data — this is
 * "my inbox / my subscriptions / my preferences", not an admin surface.
 */
import { Router, type Request, type RequestHandler } from 'express';
import { z } from 'zod';
import { HAZARD_TYPES, NOTIFICATION_CHANNELS } from '@nexus/shared';
import type { CoreServices } from '../http/container';

const { authenticate } = require('../../middleware/auth') as { authenticate: RequestHandler };

const subscribeSchema = z.object({
  placeId: z.string().uuid(),
  channels: z.array(z.enum(NOTIFICATION_CHANNELS)).min(1),
  hazardTypes: z.array(z.enum(HAZARD_TYPES)).optional(),
});
const preferenceSchema = z.object({ channel: z.enum(NOTIFICATION_CHANNELS), enabled: z.boolean() });
const pushSchema = z.object({ endpoint: z.string().url(), p256dh: z.string().min(1), auth: z.string().min(1) });

const userOf = (req: Request): string => (req as Request & { user?: { id: string } }).user?.id ?? '';

export function buildNotificationsRouter({ notifications }: CoreServices): Router {
  const router = Router();
  router.use(authenticate);

  // ── My inbox ──
  router.get('/', async (req, res) => {
    const unreadOnly = req.query.unread === 'true';
    const data = await notifications.list(userOf(req), { unreadOnly, limit: req.query.limit ? Number(req.query.limit) : undefined });
    res.json({ success: true, count: data.length, data });
  });

  router.post('/:id/read', async (req, res) => {
    await notifications.markRead(String(req.params.id), userOf(req));
    res.json({ success: true });
  });

  // ── My subscriptions (which places I get alerts for) ──
  router.get('/subscriptions', async (req, res) => {
    const data = await notifications.subscriptions(userOf(req));
    res.json({ success: true, data });
  });

  router.post('/subscriptions', async (req, res) => {
    const parsed = subscribeSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, message: 'placeId and at least one channel required', errors: parsed.error.flatten() });
      return;
    }
    await notifications.subscribe(userOf(req), parsed.data.placeId, parsed.data.channels, parsed.data.hazardTypes ?? null);
    res.status(201).json({ success: true, message: 'Subscribed' });
  });

  router.delete('/subscriptions/:placeId', async (req, res) => {
    await notifications.unsubscribe(userOf(req), String(req.params.placeId));
    res.json({ success: true, message: 'Unsubscribed' });
  });

  // ── My channel preferences ──
  router.get('/preferences', async (req, res) => {
    const data = await notifications.preferences(userOf(req));
    res.json({ success: true, data });
  });

  router.put('/preferences', async (req, res) => {
    const parsed = preferenceSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, message: 'channel and enabled required' });
      return;
    }
    await notifications.setPreference(userOf(req), parsed.data.channel, parsed.data.enabled);
    res.json({ success: true });
  });

  // ── Web-push registration ──
  router.post('/push', async (req, res) => {
    const parsed = pushSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, message: 'endpoint, p256dh, auth required' });
      return;
    }
    await notifications.registerPush(userOf(req), parsed.data);
    res.status(201).json({ success: true, message: 'Push endpoint registered' });
  });

  router.delete('/push', async (req, res) => {
    const endpoint = typeof req.query.endpoint === 'string' ? req.query.endpoint : '';
    if (!endpoint) {
      res.status(400).json({ success: false, message: 'endpoint query param required' });
      return;
    }
    await notifications.unregisterPush(endpoint);
    res.json({ success: true });
  });

  return router;
}
