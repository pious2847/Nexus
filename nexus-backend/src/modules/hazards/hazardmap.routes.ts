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
    // Historical playback (Module H, "scrub through time"): ?asOf=<ISO8601> reconstructs
    // the map as it was at that past moment instead of live "now" — see
    // hazardmap.repository.ts's listEventFeaturesAsOf for how event state is derived
    // from event_transitions rather than assuming today's hazard_events.state.
    const asOfStr = str(q.asOf);
    let asOf: Date | undefined;
    if (asOfStr) {
      const parsed = new Date(asOfStr);
      if (Number.isNaN(parsed.getTime())) {
        res.status(400).json({ success: false, message: 'asOf must be a valid ISO 8601 date/time' });
        return;
      }
      asOf = parsed;
    }
    const fc = await hazardMap.eventFeatures({
      hazardType: str(q.type),
      severity: str(q.severity),
      regionId: str(q.region),
      limit: q.limit ? Number(q.limit) : undefined,
      asOf,
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
