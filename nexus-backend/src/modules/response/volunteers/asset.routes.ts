/**
 * Response-asset registry endpoints, intended mount: /api/v1/response-assets.
 * No separate create permission — `asset.manage` covers registering + updating
 * (matching how e.g. `sanitation.manage` is a single combined permission
 * elsewhere in this codebase).
 */
import { Router, type Request, type RequestHandler } from 'express';
import { z } from 'zod';
import type { CoreServices } from '../../../core/http/container';
import { requirePermission } from '../../../core/rbac/rbac.middleware';
import type { AssetService } from './asset.service';

const { authenticate } = require('../../../middleware/auth') as { authenticate: RequestHandler };

const ASSET_TYPES = ['vehicle', 'boat', 'equipment', 'other'] as const;
const STATUSES = ['available', 'deployed', 'maintenance'] as const;

const registerSchema = z.object({
  name: z.string().min(2).max(200),
  assetType: z.enum(ASSET_TYPES),
  placeId: z.string().uuid(),
  notes: z.string().optional(),
});

const updateSchema = z.object({
  name: z.string().min(2).max(200).optional(),
  assetType: z.enum(ASSET_TYPES).optional(),
  status: z.enum(STATUSES).optional(),
  notes: z.string().optional(),
});

const assignSchema = z.object({ taskId: z.string().uuid() });

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const actorOf = (req: Request): string | null => (req as Request & { user?: { id: string } }).user?.id ?? null;

/**
 * Dependencies this router needs. Typed as a subset of `CoreServices` plus the
 * not-yet-wired `assets` service, so this file type-checks standalone before
 * the orchestrator wires it into `CoreServices` (see README).
 */
type AssetRouterDeps = Pick<CoreServices, 'geography' | 'rbac'> & { assets: AssetService };

export function buildAssetRouter({ assets, geography, rbac }: AssetRouterDeps): Router {
  const router = Router();
  router.use(authenticate);

  router.post(
    '/',
    requirePermission(rbac, 'asset.manage', async (req) => {
      const placeId = (req.body as { placeId?: string })?.placeId;
      return placeId ? (await geography.getById(placeId))?.path ?? null : null;
    }),
    async (req, res) => {
      const parsed = registerSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ success: false, message: 'Invalid asset registration', errors: parsed.error.flatten() });
        return;
      }
      const asset = await assets.register(parsed.data, actorOf(req));
      res.status(201).json({ success: true, data: asset });
    },
  );

  router.get(
    '/',
    requirePermission(rbac, 'asset.read', async (req) => {
      const scope = str(req.query.scope);
      return scope ? (await geography.getById(scope))?.path ?? null : null;
    }),
    async (req, res) => {
      const scope = str(req.query.scope);
      if (!scope) {
        res.status(400).json({ success: false, message: 'scope (a place id) query param is required' });
        return;
      }
      const rows = await assets.listByScope(scope, {
        status: str(req.query.status),
        assetType: str(req.query.assetType),
      });
      res.json({ success: true, count: rows.length, data: rows });
    },
  );

  router.get(
    '/:id',
    requirePermission(rbac, 'asset.read', (req) => assets.assetPlacePath(String(req.params.id))),
    async (req, res) => {
      const asset = await assets.getAsset(String(req.params.id));
      if (!asset) {
        res.status(404).json({ success: false, message: 'Response asset not found' });
        return;
      }
      res.json({ success: true, data: asset });
    },
  );

  router.patch(
    '/:id',
    requirePermission(rbac, 'asset.manage', (req) => assets.assetPlacePath(String(req.params.id))),
    async (req, res) => {
      const parsed = updateSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ success: false, message: 'Invalid update', errors: parsed.error.flatten() });
        return;
      }
      try {
        const asset = await assets.update(String(req.params.id), parsed.data, actorOf(req));
        res.json({ success: true, data: asset });
      } catch (err) {
        res.status(404).json({ success: false, message: (err as Error).message });
      }
    },
  );

  router.post(
    '/:id/assign',
    requirePermission(rbac, 'asset.manage', (req) => assets.assetPlacePath(String(req.params.id))),
    async (req, res) => {
      const parsed = assignSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ success: false, message: 'taskId is required' });
        return;
      }
      try {
        const asset = await assets.assignToTask(String(req.params.id), parsed.data.taskId, actorOf(req));
        res.json({ success: true, data: asset });
      } catch (err) {
        res.status(404).json({ success: false, message: (err as Error).message });
      }
    },
  );

  return router;
}
