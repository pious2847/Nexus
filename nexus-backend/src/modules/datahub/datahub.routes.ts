/**
 * Data Hub endpoints (Module G), mounted at /api/v1/datahub. Catalog
 * browsing is public but visibility-limited (optionalAuth — an
 * unauthenticated caller or one without data.dataset.read only ever sees
 * published+public datasets); everything else requires the matching
 * permission. `X-API-Key` is accepted as an alternative to a JWT on the
 * download route, for the spec's "Public Data API" partner-integration use case.
 */
import { Router, type Request, type RequestHandler } from 'express';
import { z } from 'zod';
import jwt from 'jsonwebtoken';
import type { CoreServices } from '../../core/http/container';
import { requirePermission } from '../../core/rbac/rbac.middleware';
import { DatasetAccessDeniedError, InvalidDatasetError, type DataHubService, type ViewerContext } from './datahub.service';

const auth = require('../../middleware/auth') as { authenticate: RequestHandler; optionalAuth: RequestHandler };

const LICENSES = ['cc_by', 'cc_by_sa', 'cc0', 'open_data', 'restricted', 'proprietary'] as const;
const SHARING_MODES = ['public', 'by_request', 'private'] as const;

const createSchema = z.object({
  name: z.string().min(2).max(200),
  description: z.string().max(4000).optional(),
  category: z.string().max(100).optional(),
  placeId: z.string().uuid().optional(),
  timeRangeStart: z.string().date().optional(),
  timeRangeEnd: z.string().date().optional(),
  format: z.enum(['csv', 'geojson', 'excel', 'pdf', 'json']),
  fileUrl: z.string().url().optional(),
  fileSizeBytes: z.number().int().min(0).optional(),
  rowCount: z.number().int().min(0).optional(),
  license: z.enum(LICENSES).optional(),
  attribution: z.string().max(500).optional(),
  sharingMode: z.enum(SHARING_MODES).optional(),
  containsPii: z.boolean().optional(),
});
const updateSchema = createSchema.partial();
const reviewSchema = z.object({ decision: z.enum(['published', 'rejected']) });
const requestAccessSchema = z.object({ justification: z.string().min(10).max(2000) });
const reviewRequestSchema = z.object({ decision: z.enum(['approved', 'denied']), notes: z.string().max(1000).optional() });
const apiKeySchema = z.object({ name: z.string().min(2).max(200) });

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const actorOf = (req: Request): string => (req as Request & { user?: { id: string } }).user?.id ?? '';
const userIdOf = (req: Request): string | null => (req as Request & { user?: { id: string } }).user?.id ?? null;

export type DataHubRouterDeps = Pick<CoreServices, 'rbac'> & { dataHub: DataHubService };

export function buildDataHubRouter({ dataHub, rbac }: DataHubRouterDeps): Router {
  const router = Router();

  // Catalog — public but visibility-limited. optionalAuth so an anonymous request
  // still resolves (to the public-only viewer) instead of 401ing.
  router.get('/datasets', auth.optionalAuth, async (req, res) => {
    const viewer = await dataHub.buildViewerContext(userIdOf(req), rbac);
    const rows = await dataHub.listDatasets(
      { category: str(req.query.category), status: str(req.query.status), sharingMode: str(req.query.sharingMode), search: str(req.query.search), placeId: str(req.query.placeId) },
      viewer,
    );
    res.json({ success: true, count: rows.length, data: rows });
  });

  router.get('/datasets/:id', auth.optionalAuth, async (req, res) => {
    const viewer = await dataHub.buildViewerContext(userIdOf(req), rbac);
    const dataset = await dataHub.getDataset(String(req.params.id), viewer);
    if (!dataset) {
      res.status(404).json({ success: false, message: 'Not found' });
      return;
    }
    res.json({ success: true, data: dataset });
  });

  // Download — public datasets need no auth at all; by-request/private do. Also
  // accepts X-API-Key as an alternative to a JWT (the "Public Data API").
  router.get('/datasets/:id/download', async (req, res) => {
    const apiKeyHeader = req.header('X-API-Key');
    let viewer: ViewerContext;
    let apiKeyId: string | null = null;
    if (apiKeyHeader) {
      const apiKeyViewer = await dataHub.viewerFromApiKey(apiKeyHeader);
      if (!apiKeyViewer) {
        res.status(401).json({ success: false, message: 'Invalid or revoked API key' });
        return;
      }
      viewer = apiKeyViewer;
    } else {
      // Reuse the legacy JWT check inline (no hard authenticate requirement — public datasets must stay downloadable with zero auth).
      const header = req.headers.authorization;
      let userId: string | null = null;
      if (header?.startsWith('Bearer ')) {
        try {
          userId = (jwt.verify(header.slice(7), process.env.JWT_SECRET as string) as { id: string }).id;
        } catch {
          // invalid/expired token on a route that doesn't strictly require auth -- fall through as anonymous
        }
      }
      viewer = await dataHub.buildViewerContext(userId, rbac);
    }
    try {
      const dataset = await dataHub.download(String(req.params.id), viewer, apiKeyId);
      if (!dataset.file_url) {
        res.status(404).json({ success: false, message: 'Dataset has no file attached yet' });
        return;
      }
      res.json({ success: true, data: { fileUrl: dataset.file_url, format: dataset.format } });
    } catch (err) {
      if (err instanceof DatasetAccessDeniedError) {
        res.status(403).json({ success: false, message: err.message });
        return;
      }
      res.status(404).json({ success: false, message: (err as Error).message });
    }
  });

  router.post('/datasets', auth.authenticate, requirePermission(rbac, 'data.publish'), async (req, res) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, message: 'Invalid dataset', errors: parsed.error.flatten() });
      return;
    }
    const viewer = await dataHub.buildViewerContext(actorOf(req), rbac);
    try {
      const dataset = await dataHub.create(parsed.data, actorOf(req), viewer.orgId);
      res.status(201).json({ success: true, data: dataset });
    } catch (err) {
      if (err instanceof InvalidDatasetError) {
        res.status(400).json({ success: false, message: err.message });
        return;
      }
      throw err;
    }
  });

  router.patch('/datasets/:id', auth.authenticate, requirePermission(rbac, 'data.publish'), async (req, res) => {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, message: 'Invalid update', errors: parsed.error.flatten() });
      return;
    }
    try {
      const dataset = await dataHub.update(String(req.params.id), parsed.data, actorOf(req));
      res.json({ success: true, data: dataset });
    } catch (err) {
      if (err instanceof InvalidDatasetError) {
        res.status(400).json({ success: false, message: err.message });
        return;
      }
      res.status(404).json({ success: false, message: (err as Error).message });
    }
  });

  router.post('/datasets/:id/submit-for-review', auth.authenticate, requirePermission(rbac, 'data.publish'), async (req, res) => {
    try {
      const dataset = await dataHub.submitForReview(String(req.params.id), actorOf(req));
      res.json({ success: true, data: dataset });
    } catch (err) {
      res.status(400).json({ success: false, message: (err as Error).message });
    }
  });

  router.post('/datasets/:id/review', auth.authenticate, requirePermission(rbac, 'data.publish'), async (req, res) => {
    const parsed = reviewSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, message: "decision must be 'published' or 'rejected'" });
      return;
    }
    try {
      const dataset = await dataHub.review(String(req.params.id), parsed.data.decision, actorOf(req));
      res.json({ success: true, data: dataset });
    } catch (err) {
      res.status(400).json({ success: false, message: (err as Error).message });
    }
  });

  router.post('/datasets/:id/archive', auth.authenticate, requirePermission(rbac, 'data.publish'), async (req, res) => {
    try {
      const dataset = await dataHub.archive(String(req.params.id), actorOf(req));
      res.json({ success: true, data: dataset });
    } catch (err) {
      res.status(404).json({ success: false, message: (err as Error).message });
    }
  });

  router.get('/datasets/:id/usage', auth.authenticate, requirePermission(rbac, 'data.publish'), async (req, res) => {
    const stats = await dataHub.usageStats(String(req.params.id));
    res.json({ success: true, data: stats });
  });

  // Data requests
  router.post('/datasets/:id/requests', auth.authenticate, requirePermission(rbac, 'data.request.create'), async (req, res) => {
    const parsed = requestAccessSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, message: 'A justification (10-2000 chars) is required', errors: parsed.error.flatten() });
      return;
    }
    try {
      const request = await dataHub.requestAccess(String(req.params.id), actorOf(req), parsed.data.justification);
      res.status(201).json({ success: true, data: request });
    } catch (err) {
      res.status(400).json({ success: false, message: (err as Error).message });
    }
  });

  router.get('/datasets/:id/requests', auth.authenticate, requirePermission(rbac, 'data.request.approve'), async (req, res) => {
    const rows = await dataHub.listRequestsForDataset(String(req.params.id));
    res.json({ success: true, count: rows.length, data: rows });
  });

  router.get('/my-requests', auth.authenticate, async (req, res) => {
    const rows = await dataHub.listMyRequests(actorOf(req));
    res.json({ success: true, count: rows.length, data: rows });
  });

  router.post('/requests/:id/review', auth.authenticate, requirePermission(rbac, 'data.request.approve'), async (req, res) => {
    const parsed = reviewRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, message: "decision must be 'approved' or 'denied'" });
      return;
    }
    try {
      const request = await dataHub.reviewRequest(String(req.params.id), parsed.data.decision, actorOf(req), parsed.data.notes);
      res.json({ success: true, data: request });
    } catch (err) {
      res.status(404).json({ success: false, message: (err as Error).message });
    }
  });

  // API keys — org-scoped, gated by data.publish (the same curator/admin tier that manages datasets).
  router.post('/api-keys', auth.authenticate, requirePermission(rbac, 'data.publish'), async (req, res) => {
    const parsed = apiKeySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, message: 'name is required' });
      return;
    }
    const viewer = await dataHub.buildViewerContext(actorOf(req), rbac);
    if (!viewer.orgId) {
      res.status(400).json({ success: false, message: 'You must belong to an organization to create an API key' });
      return;
    }
    const { apiKey, rawKey } = await dataHub.createApiKey(viewer.orgId, parsed.data.name, actorOf(req));
    // rawKey is returned ONCE, here, and never again — the DB only ever stores its hash.
    res.status(201).json({ success: true, data: { ...apiKey, rawKey } });
  });

  router.get('/api-keys', auth.authenticate, requirePermission(rbac, 'data.publish'), async (req, res) => {
    const viewer = await dataHub.buildViewerContext(actorOf(req), rbac);
    if (!viewer.orgId) {
      res.json({ success: true, count: 0, data: [] });
      return;
    }
    const rows = await dataHub.listApiKeys(viewer.orgId);
    res.json({ success: true, count: rows.length, data: rows });
  });

  router.delete('/api-keys/:id', auth.authenticate, requirePermission(rbac, 'data.publish'), async (req, res) => {
    try {
      const revoked = await dataHub.revokeApiKey(String(req.params.id), actorOf(req));
      res.json({ success: true, data: revoked });
    } catch (err) {
      res.status(404).json({ success: false, message: (err as Error).message });
    }
  });

  return router;
}
