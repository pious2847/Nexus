/**
 * Geography service — the API other modules use to resolve places, check
 * geographic scope (RBAC), and do point lookups. Wraps the repository so callers
 * never write SQL (CONTRIBUTING §3).
 */
import type { Db } from '../../shared/db';
import * as repo from './geography.repository';
import type { LngLat, PlaceSummary } from './geography.repository';
import { DistrictResolver, type ResolveResult } from './geography.resolver';
import { buildFeature, buildFeatureAllowNullGeometry, toFeatureCollection, type GeoFeature, type FeatureCollection } from '../../modules/hazards/hazardmap.util';

export class GeographyService {
  private resolver?: DistrictResolver;

  constructor(private readonly db: Db) {}

  countRegions(): Promise<number> {
    return repo.countByLevel(this.db, 'region');
  }

  /** All 16 regions, ordered by name. */
  regions(): Promise<PlaceSummary[]> {
    return repo.listByLevel(this.db, 'region');
  }

  /** Districts, optionally filtered to a region (by name or id). */
  async districts(regionNameOrId?: string): Promise<PlaceSummary[]> {
    if (!regionNameOrId) return repo.listByLevel(this.db, 'district');
    const region = await repo.findRegionByName(this.db, regionNameOrId);
    return repo.listByLevel(this.db, 'district', region?.id ?? regionNameOrId);
  }

  /** Resolve a legacy district string to a place (built lazily, then cached). */
  async resolveDistrict(input: string): Promise<ResolveResult | null> {
    if (!this.resolver) {
      this.resolver = new DistrictResolver(await repo.listDistrictsForResolver(this.db));
    }
    return this.resolver.resolve(input);
  }

  countDistricts(): Promise<number> {
    return repo.countByLevel(this.db, 'district');
  }

  getById(id: string): Promise<PlaceSummary | null> {
    return repo.findById(this.db, id);
  }

  getChildren(parentId: string): Promise<PlaceSummary[]> {
    return repo.getChildren(this.db, parentId);
  }

  /** Every place at/below the given ancestor path (inclusive). */
  getSubtree(ancestorPath: string): Promise<PlaceSummary[]> {
    return repo.getSubtree(this.db, ancestorPath);
  }

  /** Is `place` within (at/below) the `scope` path? Basis for RBAC geo-scoping. */
  isWithinScope(placePath: string, scopePath: string): Promise<boolean> {
    return repo.isWithin(this.db, placePath, scopePath);
  }

  /** Which district contains this point (e.g. to geo-tag a citizen report). */
  districtForPoint(point: LngLat): Promise<PlaceSummary | null> {
    return repo.findDistrictContainingPoint(this.db, point);
  }

  /** Nearest places of a level (e.g. nearest region/community to a location). */
  nearest(level: string, point: LngLat, limit = 1) {
    return repo.findNearest(this.db, level, point, limit);
  }

  /** A single place's boundary polygon as a GeoJSON Feature (Module H). Null if no boundary geometry yet. */
  async boundary(id: string): Promise<GeoFeature | null> {
    const row = await repo.getBoundary(this.db, id);
    if (!row) return null;
    return buildFeature(row.geom_json, { id: row.id, name: row.name, level: row.level });
  }

  /** All boundaries at a level (a map base layer) — every place is represented, even those without geometry yet. */
  async boundaries(level: string, regionId?: string): Promise<FeatureCollection> {
    const rows = await repo.listBoundaries(this.db, level, regionId);
    const features = rows.map((r) => buildFeatureAllowNullGeometry(r.geom_json, { id: r.id, name: r.name, level: r.level }));
    return toFeatureCollection(features, { layer: `${level}_boundaries` });
  }
}
