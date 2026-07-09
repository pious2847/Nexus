/**
 * Anticipatory-action protocol endpoints, meant to be mounted at
 * /api/v1/anticipatory (N12 — not yet wired, see README "Wiring needed").
 * Mirrors shelter.routes.ts's shape (geo-scoped RBAC via requirePermission +
 * a scoped-resource path resolver).
 */
import { Router, type Request, type RequestHandler } from 'express';
import { z } from 'zod';
import type { Permission } from '@nexus/shared';
import type { CoreServices } from '../../core/http/container';
import { requirePermission } from '../../core/rbac/rbac.middleware';
import type { AnticipatoryService } from './anticipatory.service';

const { authenticate } = require('../../middleware/auth') as { authenticate: RequestHandler };

const READ_PERM: Permission = 'anticipatory.read';
const MANAGE_PERM: Permission = 'anticipatory.manage';

const actionSchema = z.object({
  type: z.enum(['notify_focal_points', 'flag_vulnerable_evacuation', 'pre_position_relief']),
  params: z.record(z.unknown()).default({}),
});

const createSchema = z.object({
  name: z.string().min(2).max(200),
  hazardType: z.string().min(1),
  placeId: z.string().uuid(),
  triggerState: z.string().min(1),
  actions: z.array(actionSchema).min(1),
  active: z.boolean().optional(),
});

const updateSchema = z.object({
  name: z.string().min(2).max(200).optional(),
  triggerState: z.string().min(1).optional(),
  actions: z.array(actionSchema).optional(),
  active: z.boolean().optional(),
});

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const actorOf = (req: Request): string => (req as Request & { user?: { id: string } }).user?.id ?? '';

/**
 * Dependencies this router needs. Typed as a subset of `CoreServices` plus
 * the not-yet-wired `anticipatory` service, so this file type-checks
 * standalone before the orchestrator adds an `anticipatory: AnticipatoryService`
 * field to `CoreServices` (see README "Wiring needed").
 */
type AnticipatoryRouterDeps = Pick<CoreServices, 'geography' | 'rbac'> & { anticipatory: AnticipatoryService };

export function buildAnticipatoryRouter({ anticipatory, geography, rbac }: AnticipatoryRouterDeps): Router {
  const router = Router();

  router.use(authenticate);

  router.post(
    '/protocols',
    requirePermission(rbac, MANAGE_PERM, async (req) => {
      const placeId = str((req.body as { placeId?: unknown }).placeId);
      if (!placeId) return null;
      return (await geography.getById(placeId))?.path ?? null;
    }),
    async (req, res) => {
      const parsed = createSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ success: false, message: 'Invalid protocol', errors: parsed.error.flatten() });
        return;
      }
      const protocol = await anticipatory.createProtocol(parsed.data, actorOf(req));
      res.status(201).json({ success: true, data: protocol });
    },
  );

  router.get(
    '/protocols',
    requirePermission(rbac, READ_PERM, async (req) => {
      const scope = str(req.query.scope);
      return scope ? (await geography.getById(scope))?.path ?? null : null;
    }),
    async (req, res) => {
      const scope = str(req.query.scope);
      if (!scope) {
        res.status(400).json({ success: false, message: 'scope (a place id) query param is required' });
        return;
      }
      const active = str(req.query.active);
      const rows = await anticipatory.listByScope(scope, {
        hazardType: str(req.query.hazardType),
        active: active === undefined ? undefined : active === 'true',
      });
      res.json({ success: true, count: rows.length, data: rows });
    },
  );

  router.get(
    '/protocols/:id',
    requirePermission(rbac, READ_PERM, (req) => anticipatory.protocolPlacePath(String(req.params.id))),
    async (req, res) => {
      const protocol = await anticipatory.getProtocol(String(req.params.id));
      if (!protocol) {
        res.status(404).json({ success: false, message: 'Not found' });
        return;
      }
      res.json({ success: true, data: protocol });
    },
  );

  router.patch(
    '/protocols/:id',
    requirePermission(rbac, MANAGE_PERM, (req) => anticipatory.protocolPlacePath(String(req.params.id))),
    async (req, res) => {
      const parsed = updateSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ success: false, message: 'Invalid update', errors: parsed.error.flatten() });
        return;
      }
      try {
        const protocol = await anticipatory.updateProtocol(String(req.params.id), parsed.data, actorOf(req));
        res.json({ success: true, data: protocol });
      } catch (err) {
        res.status(404).json({ success: false, message: (err as Error).message });
      }
    },
  );

  router.get(
    '/activations',
    requirePermission(rbac, READ_PERM, async (req) => {
      const scope = str(req.query.scope);
      return scope ? (await geography.getById(scope))?.path ?? null : null;
    }),
    async (req, res) => {
      const scope = str(req.query.scope);
      if (!scope) {
        res.status(400).json({ success: false, message: 'scope (a place id) query param is required' });
        return;
      }
      const rows = await anticipatory.listActivations(scope);
      res.json({ success: true, count: rows.length, data: rows });
    },
  );

  return router;
}
