/**
 * Hazard event lifecycle state machine (spec 01 §4). Pure + unit-tested.
 * Transitions are forward-only; any state can be closed (auto-expire).
 */
import type { HazardEventState } from '@nexus/shared';

export const ALLOWED_TRANSITIONS: Record<HazardEventState, HazardEventState[]> = {
  predicted: ['watch', 'closed'],
  watch: ['warning', 'active', 'closed'],
  warning: ['active', 'closed'],
  active: ['response', 'recovery', 'closed'],
  response: ['recovery', 'closed'],
  recovery: ['closed'],
  closed: [],
};

export const TERMINAL_STATES: readonly HazardEventState[] = ['closed'];

export function canTransition(from: HazardEventState, to: HazardEventState): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertTransition(from: HazardEventState, to: HazardEventState): void {
  if (!canTransition(from, to)) {
    throw new Error(`Illegal hazard event transition: ${from} → ${to}`);
  }
}

export function isTerminal(state: HazardEventState): boolean {
  return TERMINAL_STATES.includes(state);
}
