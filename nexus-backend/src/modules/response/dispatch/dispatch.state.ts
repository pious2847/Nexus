/**
 * Dispatch task lifecycle state machine (Module M — Emergency Response &
 * Coordination). Pure + unit-tested. Mirrors `modules/hazards/hazards.state.ts`
 * exactly: transitions are forward-only, and `cancelled` is reachable from any
 * non-terminal state.
 */

export type DispatchStatus = 'open' | 'assigned' | 'in_progress' | 'done' | 'cancelled';

export const ALLOWED_TRANSITIONS: Record<DispatchStatus, DispatchStatus[]> = {
  open: ['assigned', 'cancelled'],
  assigned: ['in_progress', 'cancelled'],
  in_progress: ['done', 'cancelled'],
  done: [],
  cancelled: [],
};

export const TERMINAL_STATES: readonly DispatchStatus[] = ['done', 'cancelled'];

export function canTransition(from: DispatchStatus, to: DispatchStatus): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertTransition(from: DispatchStatus, to: DispatchStatus): void {
  if (!canTransition(from, to)) {
    throw new Error(`Illegal dispatch task transition: ${from} → ${to}`);
  }
}

export function isTerminal(state: DispatchStatus): boolean {
  return TERMINAL_STATES.includes(state);
}
