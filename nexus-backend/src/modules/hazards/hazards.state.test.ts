import { describe, it, expect } from 'vitest';
import { canTransition, assertTransition, isTerminal, ALLOWED_TRANSITIONS } from './hazards.state';
import { HAZARD_EVENT_STATES } from '@nexus/shared';

describe('hazard state machine', () => {
  it('allows the documented forward path', () => {
    expect(canTransition('predicted', 'watch')).toBe(true);
    expect(canTransition('watch', 'warning')).toBe(true);
    expect(canTransition('warning', 'active')).toBe(true);
    expect(canTransition('active', 'response')).toBe(true);
    expect(canTransition('response', 'recovery')).toBe(true);
    expect(canTransition('recovery', 'closed')).toBe(true);
  });

  it('allows closing from any non-terminal state', () => {
    for (const s of HAZARD_EVENT_STATES) {
      if (s !== 'closed') expect(canTransition(s, 'closed')).toBe(true);
    }
  });

  it('rejects backward / skip / illegal transitions', () => {
    expect(canTransition('warning', 'predicted')).toBe(false);
    expect(canTransition('predicted', 'active')).toBe(false); // must pass through watch
    expect(canTransition('closed', 'active')).toBe(false); // terminal
    expect(() => assertTransition('closed', 'watch')).toThrow();
  });

  it('knows terminal states', () => {
    expect(isTerminal('closed')).toBe(true);
    expect(isTerminal('active')).toBe(false);
  });

  it('covers every state in the transition map', () => {
    for (const s of HAZARD_EVENT_STATES) {
      expect(ALLOWED_TRANSITIONS[s]).toBeDefined();
    }
  });
});
