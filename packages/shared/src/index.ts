/**
 * @nexus/shared — types, Zod schemas, and constants shared by the backend and
 * frontend. Import from here (never reach into subpaths) so consumers get a
 * stable surface.
 */
export * from './constants/geography';
export * from './constants/roles';
export * from './constants/permissions';
export * from './constants/hazards';

export const SHARED_PACKAGE_VERSION = '0.0.0';
