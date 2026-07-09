/**
 * Badge catalog, a citizen's own badges, and a public leaderboard, mounted
 * at /api/v1/badges (Module C — light gamification). The catalog and
 * leaderboard are public/read-only (recognition is meant to be visible);
 * only "my badges" requires knowing who you are, which requires auth.
 */
import { Router, type Request, type RequestHandler } from 'express';
import { z } from 'zod';
import type { BadgeService } from './badges.service';

const { authenticate } = require('../../middleware/auth') as { authenticate: RequestHandler };

const leaderboardSchema = z.object({
  scope: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

const actorOf = (req: Request): string => (req as Request & { user?: { id: string } }).user?.id ?? '';

interface BadgesRouterDeps {
  badges: BadgeService;
}

export function buildBadgesRouter({ badges }: BadgesRouterDeps): Router {
  const router = Router();

  // Public — the badge catalog itself (what's earnable and how).
  router.get('/', async (_req, res) => {
    const catalog = await badges.listCatalog();
    res.json({ success: true, count: catalog.length, data: catalog });
  });

  // Public — recognition is meant to be visible; optional geo scope narrows to a district/region.
  router.get('/leaderboard', async (req, res) => {
    const parsed = leaderboardSchema.safeParse({ scope: req.query.scope, limit: req.query.limit });
    if (!parsed.success) {
      res.status(400).json({ success: false, message: 'Invalid query', errors: parsed.error.flatten() });
      return;
    }
    const rows = await badges.leaderboard(parsed.data.scope ?? null, parsed.data.limit ?? 20);
    res.json({ success: true, count: rows.length, data: rows });
  });

  // Authenticated — a citizen's own earned badges.
  router.get('/me', authenticate, async (req, res) => {
    const rows = await badges.listForUser(actorOf(req));
    res.json({ success: true, count: rows.length, data: rows });
  });

  return router;
}
