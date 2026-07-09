/**
 * Nearest-safe-place lookup, mounted at /api/v1/evacuation (N7). Public, no
 * auth — same openness level as shelters'/health-facilities' nearest
 * lookups, since this is exactly the "citizen in an active event with no
 * account" use case.
 */
import { Router } from 'express';
import { z } from 'zod';
import type { EvacuationService } from './evacuation.service';

const querySchema = z.object({
  lng: z.coerce.number().min(-180).max(180),
  lat: z.coerce.number().min(-90).max(90),
  limit: z.coerce.number().int().min(1).max(20).optional(),
});

export interface EvacuationRouterDeps {
  evacuation: EvacuationService;
}

export function buildEvacuationRouter({ evacuation }: EvacuationRouterDeps): Router {
  const router = Router();

  router.get('/nearest-safe-place', async (req, res) => {
    const parsed = querySchema.safeParse({ lng: req.query.lng, lat: req.query.lat, limit: req.query.limit });
    if (!parsed.success) {
      res.status(400).json({ success: false, message: 'lng and lat query params are required', errors: parsed.error.flatten() });
      return;
    }
    const { lng, lat, limit } = parsed.data;
    const suggestions = await evacuation.findSafestNearby({ lng, lat }, limit ?? 5);
    res.json({
      success: true,
      count: suggestions.length,
      note: 'Straight-line heading and hazard-aware ranking only — not turn-by-turn road routing.',
      data: suggestions,
    });
  });

  return router;
}
