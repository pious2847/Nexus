/**
 * Pure trust math for citizen reports (decided model: verification + reputation +
 * corroboration). No DB — unit-tested.
 */

/** Reputation delta applied to a reporter when their report is verified/rejected. */
export const REPUTATION_ON_VERIFY = 5;
export const REPUTATION_ON_REJECT = -2;

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Initial confidence for a fresh single report, scaled by reporter reputation (0.30–0.60). */
export function computeInitialConfidence(reputation: number): number {
  const rep = Math.max(0, Math.min(reputation, 100));
  return round2(0.3 + (rep / 100) * 0.3);
}

/**
 * Confidence for a corroborated cluster of `size` independent reports.
 * Grows with each corroboration, capped (never certainty from crowd alone).
 */
export function corroborationConfidence(size: number): number {
  return round2(Math.min(0.95, 0.4 + 0.15 * Math.max(0, size - 1)));
}

/** New reputation score after a verification decision (floored at 0). */
export function applyReputationDelta(current: number, decision: 'verified' | 'rejected'): number {
  const delta = decision === 'verified' ? REPUTATION_ON_VERIFY : REPUTATION_ON_REJECT;
  return Math.max(0, current + delta);
}
