/**
 * Canonical geography constants for the `places` tree (see
 * docs/specs/03-foundation-data-model.md). Every domain record is tagged to a
 * place at one of these levels.
 */
export const PLACE_LEVELS = [
  'country',
  'region',
  'district',
  'constituency',
  'community',
] as const;
export type PlaceLevel = (typeof PLACE_LEVELS)[number];

/** District classification (Local Governance Act structure). */
export const DISTRICT_CATEGORIES = ['metropolitan', 'municipal', 'district'] as const;
export type DistrictCategory = (typeof DISTRICT_CATEGORIES)[number];

/** Current official administrative counts for Ghana (verified 2026-07-02). */
export const GHANA_REGION_COUNT = 16;
export const GHANA_DISTRICT_COUNT = 261;

/** WGS84 — the SRID used for all geometry/geography columns. */
export const SRID_WGS84 = 4326;
