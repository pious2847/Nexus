import { describe, it, expect } from 'vitest';
import { HAZARD_EVENT_STATES, GHANA_DISTRICT_COUNT } from '@nexus/shared';

/**
 * Proves the backend ↔ @nexus/shared wiring works (TypeScript + Vitest +
 * workspace alias). Real module tests arrive as features migrate (spec 04).
 */
describe('backend ↔ shared wiring', () => {
  it('imports shared constants', () => {
    expect(HAZARD_EVENT_STATES).toContain('warning');
    expect(GHANA_DISTRICT_COUNT).toBe(261);
  });
});
