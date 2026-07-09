/**
 * Hazard-aware nearest-safe-place lookup (N7). Honest scope: this ranks
 * candidate shelters by distance and DEPRIORITIZES (not silently excludes —
 * a shelter is still better than nothing) any whose own place is currently
 * covered by an active severe/extreme hazard event, since sending someone
 * *into* the hazard defeats the purpose. It is NOT road-network routing —
 * see bearing.ts's file header for why (no road-network dataset, no
 * pgrouting extension installed).
 */
import { sql } from 'drizzle-orm';
import type { Db } from '../../shared/db';

export interface SafePlaceCandidate {
  id: string;
  kind: 'shelter' | 'health_facility';
  name: string;
  place_id: string;
  lng: number;
  lat: number;
  capacity: number | null;
  current_occupancy: number | null;
  meters: number;
  hazard_affected: boolean;
  hazard_types: string[];
}

const point = (lng: number, lat: number) => sql`ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)`;

/**
 * A place is "hazard affected" if it (or an ancestor place) has an active
 * (not closed) severe/extreme hazard event right now — same severity bar as
 * N12's default trigger tier, reused here for consistency.
 */
const HAZARD_AFFECTED_SUBQUERY = (placeIdExpr: ReturnType<typeof sql>) => sql`
  EXISTS (
    SELECT 1 FROM hazard_events he
    WHERE he.state <> 'closed' AND he.severity IN ('severe', 'extreme')
      AND he.place_id IS NOT NULL
      AND (SELECT path FROM places WHERE id = ${placeIdExpr}) <@ (SELECT path FROM places WHERE id = he.place_id)
  )
`;

const AFFECTING_TYPES_SUBQUERY = (placeIdExpr: ReturnType<typeof sql>) => sql`
  COALESCE((
    SELECT json_agg(DISTINCT he.hazard_type) FROM hazard_events he
    WHERE he.state <> 'closed' AND he.severity IN ('severe', 'extreme')
      AND he.place_id IS NOT NULL
      AND (SELECT path FROM places WHERE id = ${placeIdExpr}) <@ (SELECT path FROM places WHERE id = he.place_id)
  ), '[]'::json)
`;

export async function findSafestNearby(db: Db, from: { lng: number; lat: number }, limit: number): Promise<SafePlaceCandidate[]> {
  const p = point(from.lng, from.lat);
  const r = await db.execute(sql`
    (
      SELECT id, 'shelter' AS kind, name, place_id, ST_X(geometry) AS lng, ST_Y(geometry) AS lat,
             capacity, current_occupancy, ST_Distance(geometry::geography, ${p}::geography) AS meters,
             ${HAZARD_AFFECTED_SUBQUERY(sql`place_id`)} AS hazard_affected,
             ${AFFECTING_TYPES_SUBQUERY(sql`place_id`)} AS hazard_types
      FROM shelters WHERE status = 'open' AND geometry IS NOT NULL
    )
    UNION ALL
    (
      SELECT id, 'health_facility' AS kind, name, place_id, ST_X(geometry) AS lng, ST_Y(geometry) AS lat,
             bed_count AS capacity, NULL AS current_occupancy, ST_Distance(geometry::geography, ${p}::geography) AS meters,
             ${HAZARD_AFFECTED_SUBQUERY(sql`place_id`)} AS hazard_affected,
             ${AFFECTING_TYPES_SUBQUERY(sql`place_id`)} AS hazard_types
      FROM health_facilities WHERE status = 'active' AND geometry IS NOT NULL
    )
    ORDER BY hazard_affected ASC, meters ASC
    LIMIT ${limit}
  `);
  return r.rows as unknown as SafePlaceCandidate[];
}
