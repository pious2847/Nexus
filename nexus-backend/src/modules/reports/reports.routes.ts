/**
 * Citizen incident reporting endpoints, mounted at /api/v1/reports.
 * - submit: optional auth (citizens with or without an account)
 * - list/get: officers (report.read)
 * - verify/reject: officers/moderators (report.verify), geo-scoped
 * - promote: hazard.event.create, geo-scoped
 */
import { Router, type Request, type RequestHandler } from 'express';
import { z } from 'zod';
import { CAP_SEVERITIES, HAZARD_TYPES } from '@nexus/shared';
import type { CoreServices } from '../../core/http/container';
import { requirePermission } from '../../core/rbac/rbac.middleware';

const auth = require('../../middleware/auth') as { authenticate: RequestHandler; optionalAuth: RequestHandler };

const submitSchema = z.object({
  hazardType: z.enum(HAZARD_TYPES).optional(),
  placeId: z.string().uuid().optional(),
  lng: z.number().min(-180).max(180).optional(),
  lat: z.number().min(-90).max(90).optional(),
  title: z.string().min(3).max(200),
  description: z.string().max(2000).optional(),
  media: z.array(z.string().url()).optional(),
  source: z.enum(['pwa', 'sms', 'whatsapp', 'voice']).optional(),
  reporterPhone: z.string().min(8).max(20).optional(),
});
const reviewSchema = z.object({ decision: z.enum(['verified', 'rejected']), reason: z.string().optional() });
const promoteSchema = z.object({
  hazardType: z.enum(HAZARD_TYPES).optional(),
  severity: z.enum(CAP_SEVERITIES).optional(),
  title: z.string().optional(),
});

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const actorOf = (req: Request): string | null => (req as Request & { user?: { id: string } }).user?.id ?? null;

export function buildReportsRouter({ reports, rbac }: CoreServices): Router {
  const router = Router();

  // Submit — anyone (optionally authenticated). Reporter id attached if logged in.
  router.post('/', auth.optionalAuth, async (req, res) => {
    const parsed = submitSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, message: 'Invalid report', errors: parsed.error.flatten() });
      return;
    }
    const report = await reports.submit(parsed.data, actorOf(req));
    res.status(201).json({ success: true, message: 'Report submitted', data: report });
  });

  // List / detail — officers
  router.get('/', auth.authenticate, requirePermission(rbac, 'report.read'), async (req, res) => {
    const data = await reports.listReports({
      status: str(req.query.status),
      hazardType: str(req.query.type),
      placeId: str(req.query.place),
      limit: req.query.limit ? Number(req.query.limit) : undefined,
    });
    res.json({ success: true, count: data.length, data });
  });

  router.get('/:id', auth.authenticate, requirePermission(rbac, 'report.read'), async (req, res) => {
    const report = await reports.getReport(String(req.params.id));
    if (!report) {
      res.status(404).json({ success: false, message: 'Report not found' });
      return;
    }
    res.json({ success: true, data: report });
  });

  // Verify / reject — report.verify, scoped to the report's place
  router.post(
    '/:id/review',
    auth.authenticate,
    requirePermission(rbac, 'report.verify', (req) => reports.reportPlacePath(String(req.params.id))),
    async (req, res) => {
      const parsed = reviewSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ success: false, message: 'decision must be verified|rejected' });
        return;
      }
      try {
        const report = await reports.review(String(req.params.id), actorOf(req) as string, parsed.data.decision, parsed.data.reason);
        res.json({ success: true, data: report });
      } catch (err) {
        res.status(404).json({ success: false, message: (err as Error).message });
      }
    },
  );

  // Promote to a hazard event — hazard.event.create, scoped to the report's place
  router.post(
    '/:id/promote',
    auth.authenticate,
    requirePermission(rbac, 'hazard.event.create', (req) => reports.reportPlacePath(String(req.params.id))),
    async (req, res) => {
      const parsed = promoteSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ success: false, message: 'Invalid promotion' });
        return;
      }
      try {
        const result = await reports.promote(String(req.params.id), actorOf(req) as string, parsed.data);
        res.status(201).json({ success: true, data: result });
      } catch (err) {
        res.status(400).json({ success: false, message: (err as Error).message });
      }
    },
  );

  return router;
}
