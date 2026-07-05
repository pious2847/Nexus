/**
 * National multi-hazard map service (MASTER_PLAN Module H). Turns hazard_events
 * + places into GeoJSON for a map frontend: raw event features, and a
 * per-district risk choropleth aggregated over the geography subtree.
 */
import type { Db } from '../../shared/db';
import * as repo from './hazardmap.repository';
import { buildFeature, buildFeatureAllowNullGeometry, rankToSeverity, severityColor, toFeatureCollection, type FeatureCollection } from './hazardmap.util';

export class HazardMapService {
  constructor(private readonly db: Db) {}

  async eventFeatures(filter: repo.EventFeatureFilter): Promise<FeatureCollection> {
    const rows = await repo.listEventFeatures(this.db, filter);
    const features = rows.map((r) =>
      buildFeature(r.geom_json, {
        id: r.id,
        hazardType: r.hazard_type,
        severity: r.severity,
        color: r.color ?? severityColor(r.severity as never),
        state: r.state,
        title: r.title,
        confidence: r.confidence,
        placeName: r.place_name,
        placeLevel: r.place_level,
        createdAt: r.created_at,
      }),
    );
    return toFeatureCollection(features, { layer: 'hazard_events' });
  }

  /**
   * One feature per district, always — including the handful without boundary
   * data yet (e.g. Guan, Oti), which get `geometry: null` + `hasGeometry: false`
   * so their risk status is still visible (list views, alerts) even though they
   * can't be drawn on the map until that geometry is sourced.
   */
  async districtRisk(): Promise<FeatureCollection> {
    const rows = await repo.listDistrictRisk(this.db);
    const features = rows.map((r) => {
      const severity = rankToSeverity(r.max_rank ?? 0);
      return buildFeatureAllowNullGeometry(r.geom_json, {
        id: r.id,
        name: r.name,
        riskSeverity: severity,
        riskColor: severityColor(severity),
        hazardTypes: r.hazard_types ?? [],
      });
    });
    return toFeatureCollection(features, { layer: 'district_risk' });
  }

  async summary() {
    const rows = await repo.nationalSummary(this.db);
    const byHazard: Record<string, { total: number; bySeverity: Record<string, number> }> = {};
    for (const r of rows) {
      const bucket = (byHazard[r.hazard_type] ??= { total: 0, bySeverity: {} });
      bucket.total += r.count;
      bucket.bySeverity[r.severity ?? 'unknown'] = r.count;
    }
    return { totalActive: rows.reduce((sum, r) => sum + r.count, 0), byHazard };
  }
}
