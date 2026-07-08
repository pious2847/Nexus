/**
 * SOS / panic-button endpoints, mounted at /api/v1/sos (spec 02 N2).
 * POST / is the "big red button" — designed for a future PWA reading
 * navigator.geolocation and posting immediately; SMS is the fallback
 * channel (modules/safety/sms) since raw SMS can't carry live GPS.
 */
import { Router, type Request, type RequestHandler } from 'express';
import { z } from 'zod';
import type { CoreServices } from '../../core/http/container';
import { requirePermission } from '../../core/rbac/rbac.middleware';

const { authenticate } = require('../../middleware/auth') as { authenticate: RequestHandler };

const raiseSchema = z.object({
  lng: z.number().min(-180).max(180),
  lat: z.number().min(-90).max(90),
  dangerType: z.string().max(50).optional(),
  notes: z.string().max(500).optional(),
});

const actorOf = (req: Request): string => (req as Request & { user?: { id: string } }).user?.id ?? '';
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

export function buildSosRouter({ sos, geography, rbac }: CoreServices): Router {
  const router = Router();
  router.use(authenticate);

  // No target-place resolver (national-scoped check): we don't know the place until
  // after reverse-geocoding the lat/lng, and every account (citizens included) holds
  // a NATIONAL sos.create grant (place_id NULL at signup — auth.repository.ts) so
  // this never blocks a real SOS on geo-scope. See the read/manage routes below for
  // the geo-scoped officer view.
  router.post('/', requirePermission(rbac, 'sos.create'), async (req, res) => {
    const parsed = raiseSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, message: 'Invalid SOS — lng/lat required', errors: parsed.error.flatten() });
      return;
    }
    const alert = await sos.raise({ ...parsed.data, locationPrecision: 'gps' }, actorOf(req));
    res.status(201).json({ success: true, data: alert });
  });

  // Active (open/acknowledged) SOS alerts in a scope — officer/moderator view.
  router.get(
    '/',
    requirePermission(rbac, 'sos.read', async (req) => {
      const scope = str(req.query.scope);
      return scope ? (await geography.getById(scope))?.path ?? null : null;
    }),
    async (req, res) => {
      const scope = str(req.query.scope);
      if (!scope) {
        res.status(400).json({ success: false, message: 'scope (a place id) query param is required' });
        return;
      }
      const rows = await sos.listActiveByScope(scope);
      res.json({ success: true, count: rows.length, data: rows });
    },
  );

  router.get(
    '/:id',
    requirePermission(rbac, 'sos.read', (req) => sos.sosPlacePath(String(req.params.id))),
    async (req, res) => {
      const alert = await sos.getSos(String(req.params.id));
      if (!alert) {
        res.status(404).json({ success: false, message: 'Not found' });
        return;
      }
      res.json({ success: true, data: alert });
    },
  );

  router.post(
    '/:id/acknowledge',
    requirePermission(rbac, 'sos.manage', (req) => sos.sosPlacePath(String(req.params.id))),
    async (req, res) => {
      try {
        const alert = await sos.acknowledge(String(req.params.id), actorOf(req));
        res.json({ success: true, data: alert });
      } catch (err) {
        res.status(404).json({ success: false, message: (err as Error).message });
      }
    },
  );

  const resolveSchema = z.object({ status: z.enum(['resolved', 'false_alarm']) });
  router.post(
    '/:id/resolve',
    requirePermission(rbac, 'sos.manage', (req) => sos.sosPlacePath(String(req.params.id))),
    async (req, res) => {
      const parsed = resolveSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ success: false, message: "status must be 'resolved' or 'false_alarm'" });
        return;
      }
      try {
        const alert = await sos.resolve(String(req.params.id), actorOf(req), parsed.data.status);
        res.json({ success: true, data: alert });
      } catch (err) {
        res.status(404).json({ success: false, message: (err as Error).message });
      }
    },
  );

  return router;
}
