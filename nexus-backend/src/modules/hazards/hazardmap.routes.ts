/**
 * National multi-hazard map endpoints, mounted at /api/v1/hazard-map. Public
 * reads — map transparency is part of the platform's mission (MASTER_PLAN
 * Module H). Distinct from the legacy /api/v1/map (sanitation asset layers).
 */
import { Router } from 'express';
import type { HazardMapService } from './hazardmap.service';

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

export function buildHazardMapRouter(hazardMap: HazardMapService): Router {
  const router = Router();

  router.get('/events', async (req, res) => {
    const q = req.query;
    const fc = await hazardMap.eventFeatures({
      hazardType: str(q.type),
      severity: str(q.severity),
      regionId: str(q.region),
      limit: q.limit ? Number(q.limit) : undefined,
    });
    res.json(fc);
  });

  router.get('/districts', async (_req, res) => {
    res.json(await hazardMap.districtRisk());
  });

  router.get('/summary', async (_req, res) => {
    res.json({ success: true, data: await hazardMap.summary() });
  });

  return router;
}
