/**
 * Pure great-circle bearing/distance math (N7). No DB, no network —
 * unit-tested. This is the honest scope of "routing" here: a straight-line
 * heading and distance to a safe place, NOT road-network-aware routing.
 * True routing (avoiding flooded/on-fire road segments via PostGIS +
 * pgrouting) needs a Ghana road-network dataset that hasn't been ingested
 * into this platform — the `pgrouting` extension isn't even installed on
 * the current Neon branch. Documented as a real future upgrade, not
 * claimed as done.
 */

const toRad = (deg: number) => (deg * Math.PI) / 180;
const toDeg = (rad: number) => (rad * 180) / Math.PI;
const EARTH_RADIUS_M = 6371000;

export const COMPASS_POINTS = [
  'N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
  'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW',
] as const;

/** Initial bearing (degrees, 0-360, 0 = north) from `from` to `to`. */
export function bearingDegrees(from: { lng: number; lat: number }, to: { lng: number; lat: number }): number {
  const lat1 = toRad(from.lat);
  const lat2 = toRad(to.lat);
  const dLng = toRad(to.lng - from.lng);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  const deg = toDeg(Math.atan2(y, x));
  return (deg + 360) % 360;
}

/** Nearest 16-point compass direction for a bearing in degrees. */
export function compassPoint(bearing: number): (typeof COMPASS_POINTS)[number] {
  const index = Math.round(((bearing % 360) / 360) * 16) % 16;
  return COMPASS_POINTS[index];
}

/** Haversine great-circle distance in meters. */
export function distanceMeters(from: { lng: number; lat: number }, to: { lng: number; lat: number }): number {
  const lat1 = toRad(from.lat);
  const lat2 = toRad(to.lat);
  const dLat = toRad(to.lat - from.lat);
  const dLng = toRad(to.lng - from.lng);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(EARTH_RADIUS_M * c);
}

export interface Heading {
  bearingDegrees: number;
  compassPoint: (typeof COMPASS_POINTS)[number];
  distanceMeters: number;
}

/** Straight-line heading + distance from `from` to `to` — see file header for scope honesty. */
export function computeHeading(from: { lng: number; lat: number }, to: { lng: number; lat: number }): Heading {
  return {
    bearingDegrees: Math.round(bearingDegrees(from, to)),
    compassPoint: compassPoint(bearingDegrees(from, to)),
    distanceMeters: distanceMeters(from, to),
  };
}
