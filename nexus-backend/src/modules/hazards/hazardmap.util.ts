/**
 * Pure helpers for the national multi-hazard map (MASTER_PLAN Module H).
 * No DB, no framework — turns rows into GeoJSON features and aggregates
 * severity for a district risk choropleth.
 */
import { SEVERITY_COLORS, type CapSeverity } from '@nexus/shared';

/** Neutral color for a place with no currently active hazard. */
export const NO_RISK_COLOR = '#9E9E9E';

const RANK: Record<CapSeverity, number> = { minor: 1, moderate: 2, severe: 3, extreme: 4 };

/** Numeric rank for comparing severities; null/none = 0 (no active hazard). */
export function severityRank(severity: CapSeverity | null | undefined): number {
  return severity ? RANK[severity] : 0;
}

const RANK_TO_SEVERITY: Record<number, CapSeverity | null> = { 0: null, 1: 'minor', 2: 'moderate', 3: 'severe', 4: 'extreme' };

/** Inverse of severityRank — the highest severity at a given rank (0 = none). */
export function rankToSeverity(rank: number): CapSeverity | null {
  return RANK_TO_SEVERITY[rank] ?? null;
}

/** Color for a severity, or the neutral no-risk color when there isn't one. */
export function severityColor(severity: CapSeverity | null | undefined): string {
  return severity ? SEVERITY_COLORS[severity] : NO_RISK_COLOR;
}

export interface GeoFeature {
  type: 'Feature';
  geometry: unknown;
  properties: Record<string, unknown>;
}
export interface FeatureCollection {
  type: 'FeatureCollection';
  features: GeoFeature[];
  meta: { count: number; generatedAt: string; [k: string]: unknown };
}

/** Build a GeoJSON Feature from a geometry JSON string (as returned by ST_AsGeoJSON); null if no geometry. */
export function buildFeature(geomJson: string | null | undefined, properties: Record<string, unknown>): GeoFeature | null {
  if (!geomJson) return null;
  try {
    return { type: 'Feature', geometry: JSON.parse(geomJson), properties };
  } catch {
    return null;
  }
}

/**
 * Like `buildFeature`, but always returns a Feature — with `geometry: null`
 * (valid per the GeoJSON spec) when there's nothing to draw, plus a
 * `hasGeometry: false` marker. Used where every row must be represented (e.g.
 * a national district list) even if a handful lack boundary data — a citizen
 * or official should still see that place's risk, just not on the map yet.
 */
export function buildFeatureAllowNullGeometry(geomJson: string | null | undefined, properties: Record<string, unknown>): GeoFeature {
  const withGeom = geomJson ? buildFeature(geomJson, properties) : null;
  if (withGeom) return { ...withGeom, properties: { ...withGeom.properties, hasGeometry: true } };
  return { type: 'Feature', geometry: null, properties: { ...properties, hasGeometry: false } };
}

/** Wrap features into a FeatureCollection with standard metadata. */
export function toFeatureCollection(features: (GeoFeature | null)[], meta: Record<string, unknown> = {}): FeatureCollection {
  const valid = features.filter((f): f is GeoFeature => f !== null);
  return { type: 'FeatureCollection', features: valid, meta: { count: valid.length, generatedAt: new Date().toISOString(), ...meta } };
}
