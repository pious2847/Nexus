/**
 * Read-only geography endpoints, mounted at /api/v1/geography. Public reference
 * data (regions, districts) + helpers (resolve a district string, district for a
 * point). This is the first HTTP surface of the national geography backbone.
 */
import { Router } from 'express';
import type { CoreServices } from '../http/container';

export function buildGeographyRouter({ geography }: CoreServices): Router {
  const router = Router();

  router.get('/regions', async (_req, res) => {
    res.json({ success: true, data: await geography.regions() });
  });

  router.get('/districts', async (req, res) => {
    const region = typeof req.query.region === 'string' ? req.query.region : undefined;
    const data = await geography.districts(region);
    res.json({ success: true, count: data.length, data });
  });

  router.get('/resolve', async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q : '';
    if (!q) return res.status(400).json({ success: false, message: 'query param q required' });
    return res.json({ success: true, data: await geography.resolveDistrict(q) });
  });

  router.get('/district-for-point', async (req, res) => {
    const lng = Number(req.query.lng);
    const lat = Number(req.query.lat);
    if (Number.isNaN(lng) || Number.isNaN(lat)) {
      return res.status(400).json({ success: false, message: 'numeric lng and lat required' });
    }
    return res.json({ success: true, data: await geography.districtForPoint({ lng, lat }) });
  });

  // Boundary polygons (Module H) — stored since the Phase 0 geography seed but never
  // served over HTTP before. Registered BEFORE '/:id/boundary' below has no ambiguity
  // risk (different path shape), but '/boundaries' (bulk) is registered ahead of
  // nothing conflicting either way; kept together here for readability.
  router.get('/boundaries', async (req, res) => {
    const level = typeof req.query.level === 'string' ? req.query.level : 'district';
    const region = typeof req.query.region === 'string' ? req.query.region : undefined;
    res.json(await geography.boundaries(level, region));
  });

  router.get('/:id/boundary', async (req, res) => {
    const feature = await geography.boundary(String(req.params.id));
    if (!feature) {
      res.status(404).json({ success: false, message: 'Place not found, or has no boundary geometry yet' });
      return;
    }
    res.json(feature);
  });

  return router;
}
