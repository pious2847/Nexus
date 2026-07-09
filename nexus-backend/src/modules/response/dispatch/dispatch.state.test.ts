import { describe, it, expect } from 'vitest';
import { canTransition, assertTransition, isTerminal, ALLOWED_TRANSITIONS, type DispatchStatus } from './dispatch.state';

const ALL_STATES: DispatchStatus[] = ['open', 'assigned', 'in_progress', 'done', 'cancelled'];

describe('dispatch task state machine', () => {
  it('allows the documented forward path', () => {
    expect(canTransition('open', 'assigned')).toBe(true);
    expect(canTransition('assigned', 'in_progress')).toBe(true);
    expect(canTransition('in_progress', 'done')).toBe(true);
  });

  it('allows cancelling from any non-terminal state', () => {
    for (const s of ALL_STATES) {
      if (s !== 'done' && s !== 'cancelled') expect(canTransition(s, 'cancelled')).toBe(true);
    }
  });

  it('rejects backward / skip / illegal transitions', () => {
    expect(canTransition('assigned', 'open')).toBe(false);
    expect(canTransition('open', 'in_progress')).toBe(false); // must pass through assigned
    expect(canTransition('open', 'done')).toBe(false); // must pass through assigned + in_progress
    expect(canTransition('done', 'in_progress')).toBe(false); // terminal
    expect(canTransition('cancelled', 'open')).toBe(false); // terminal
    expect(() => assertTransition('done', 'open')).toThrow();
    expect(() => assertTransition('open', 'done')).toThrow();
  });

  it('knows terminal states', () => {
    expect(isTerminal('done')).toBe(true);
    expect(isTerminal('cancelled')).toBe(true);
    expect(isTerminal('open')).toBe(false);
    expect(isTerminal('assigned')).toBe(false);
    expect(isTerminal('in_progress')).toBe(false);
  });

  it('covers every state in the transition map', () => {
    for (const s of ALL_STATES) {
      expect(ALLOWED_TRANSITIONS[s]).toBeDefined();
    }
  });

  it('never allows a transition from a state to itself', () => {
    for (const s of ALL_STATES) {
      expect(canTransition(s, s)).toBe(false);
    }
  });
});
