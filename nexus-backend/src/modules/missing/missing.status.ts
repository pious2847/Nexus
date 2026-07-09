/**
 * Pure status helpers for missing-persons records (spec 02 N3). No DB — unit
 * tested. Unlike dispatch/hazard-event state, this deliberately does NOT
 * enforce a transition matrix (any officer can move a record between any of
 * the four states, e.g. reopening a wrongly-closed record) — we only need to
 * validate that a given value is one of the DB enum's members, and to know
 * which of them count as "resolved" so the service layer can stamp
 * resolved_by/resolved_at.
 */

export type MissingPersonStatus = 'missing' | 'found' | 'reunified' | 'closed';

export const MISSING_PERSON_STATUSES: readonly MissingPersonStatus[] = ['missing', 'found', 'reunified', 'closed'];

/** Statuses that represent the case being resolved one way or another. */
export const RESOLVED_MISSING_PERSON_STATUSES: readonly MissingPersonStatus[] = ['found', 'reunified', 'closed'];

export function isValidMissingStatus(value: string): value is MissingPersonStatus {
  return (MISSING_PERSON_STATUSES as readonly string[]).includes(value);
}

/** Does moving to this status mean the case should be marked resolved (resolved_by/resolved_at set)? */
export function isResolvedMissingStatus(status: MissingPersonStatus): boolean {
  return (RESOLVED_MISSING_PERSON_STATUSES as readonly string[]).includes(status);
}
