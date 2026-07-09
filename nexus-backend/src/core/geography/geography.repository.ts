/**
 * Data access for the `places` tree. All SQL lives here (CONTRIBUTING §3).
 * PostGIS/ltree operations use raw `sql` fragments through Drizzle.
 */
import { sql } from 'drizzle-orm';
import type { Db } from '../../shared/db';

export interface PlaceSummary {
  id: string;
  parent_id: string | null;
  level: string;
  code: string | null;
  name: string;
  category: string | null;
  population: number | null;
  path: string;
}

/** A point on the earth as [longitude, latitude]. */
export interface LngLat {
  lng: number;
  lat: number;
}

const SUMMARY_COLS = sql`id, parent_id, level, code, name, category, population, path::text AS path`;

export async function countByLevel(db: Db, level: string): Promise<number> {
  const r = await db.execute(sql`SELECT count(*)::int AS n FROM places WHERE level = ${level}`);
  return (r.rows[0] as { n: number }).n;
}

export async function findById(db: Db, id: string): Promise<PlaceSummary | null> {
  const r = await db.execute(sql`SELECT ${SUMMARY_COLS} FROM places WHERE id = ${id}`);
  return (r.rows[0] as unknown as PlaceSummary) ?? null;
}

export async function getChildren(db: Db, parentId: string): Promise<PlaceSummary[]> {
  const r = await db.execute(
    sql`SELECT ${SUMMARY_COLS} FROM places WHERE parent_id = ${parentId} ORDER BY name`,
  );
  return r.rows as unknown as PlaceSummary[];
}

/** List places of a level, optionally under a given parent, ordered by name. */
export async function listByLevel(db: Db, level: string, parentId?: string): Promise<PlaceSummary[]> {
  const parentFilter = parentId ? sql` AND parent_id = ${parentId}` : sql``;
  const r = await db.execute(
    sql`SELECT ${SUMMARY_COLS} FROM places WHERE level = ${level}${parentFilter} ORDER BY name`,
  );
  return r.rows as unknown as PlaceSummary[];
}

export interface BoundaryRow {
  id: string;
  name: string;
  level: string;
  geom_json: string | null;
}

/**
 * A single place's boundary polygon as GeoJSON text (Module H — stored since
 * Phase 0's geography seed but never served over HTTP until now).
 * `geom_json` is null for places with no boundary geometry yet (a handful of
 * districts/communities, e.g. Guan — a tracked Phase 0 data gap).
 */
export async function getBoundary(db: Db, id: string): Promise<BoundaryRow | null> {
  const r = await db.execute(sql`SELECT id, name, level, ST_AsGeoJSON(boundary) AS geom_json FROM places WHERE id = ${id}`);
  return (r.rows[0] as unknown as BoundaryRow) ?? null;
}

/** Every place at a level (optionally under a region), for a map base layer. */
export async function listBoundaries(db: Db, level: string, regionId?: string): Promise<BoundaryRow[]> {
  const conds = [sql`level = ${level}`];
  if (regionId) conds.push(sql`path <@ (SELECT path FROM places WHERE id = ${regionId})`);
  const where = sql.join(conds, sql` AND `);
  const r = await db.execute(sql`SELECT id, name, level, ST_AsGeoJSON(boundary) AS geom_json FROM places WHERE ${where} ORDER BY name`);
  return r.rows as unknown as BoundaryRow[];
}

/** Find a region by (case-insensitive) name. */
export async function findRegionByName(db: Db, name: string): Promise<PlaceSummary | null> {
  const r = await db.execute(
    sql`SELECT ${SUMMARY_COLS} FROM places WHERE level = 'region' AND lower(name) = lower(${name}) LIMIT 1`,
  );
  return (r.rows[0] as unknown as PlaceSummary) ?? null;
}

/** All places at or below an ancestor path (inclusive), via ltree `<@`. */
export async function getSubtree(db: Db, ancestorPath: string): Promise<PlaceSummary[]> {
  const r = await db.execute(
    sql`SELECT ${SUMMARY_COLS} FROM places WHERE path <@ ${ancestorPath}::ltree ORDER BY path`,
  );
  return r.rows as unknown as PlaceSummary[];
}

/** True if descendantPath is at or below ancestorPath (used for RBAC geo-scope). */
export async function isWithin(db: Db, descendantPath: string, ancestorPath: string): Promise<boolean> {
  const r = await db.execute(sql`SELECT (${descendantPath}::ltree <@ ${ancestorPath}::ltree) AS within`);
  return (r.rows[0] as { within: boolean }).within;
}

/** The district whose boundary contains the given point (or null). */
export async function findDistrictContainingPoint(db: Db, p: LngLat): Promise<PlaceSummary | null> {
  const r = await db.execute(sql`
    SELECT ${SUMMARY_COLS} FROM places
    WHERE level = 'district'
      AND boundary IS NOT NULL
      AND ST_Covers(boundary, ST_SetSRID(ST_MakePoint(${p.lng}, ${p.lat}), 4326)::geography)
    LIMIT 1
  `);
  return (r.rows[0] as unknown as PlaceSummary) ?? null;
}

/** All districts (id, name, region name) — used to build the district resolver. */
export async function listDistrictsForResolver(
  db: Db,
): Promise<{ id: string; name: string; regionName: string | null }[]> {
  const r = await db.execute(sql`
    SELECT d.id, d.name, r.name AS region_name
    FROM places d LEFT JOIN places r ON d.parent_id = r.id
    WHERE d.level = 'district'
  `);
  return (r.rows as unknown as { id: string; name: string; region_name: string | null }[]).map((row) => ({
    id: row.id,
    name: row.name,
    regionName: row.region_name,
  }));
}

/** Nearest N places of a level to a point, by great-circle distance. */
export async function findNearest(
  db: Db,
  level: string,
  p: LngLat,
  limit = 1,
): Promise<(PlaceSummary & { meters: number })[]> {
  const point = sql`ST_SetSRID(ST_MakePoint(${p.lng}, ${p.lat}), 4326)::geography`;
  const r = await db.execute(sql`
    SELECT ${SUMMARY_COLS}, ST_Distance(centroid, ${point}) AS meters
    FROM places
    WHERE level = ${level} AND centroid IS NOT NULL
    ORDER BY centroid <-> ${point}
    LIMIT ${limit}
  `);
  return r.rows as unknown as (PlaceSummary & { meters: number })[];
}
