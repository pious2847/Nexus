import { describe, it, expect } from 'vitest';
import {
  PLACE_LEVELS,
  GHANA_REGION_COUNT,
  GHANA_DISTRICT_COUNT,
  ROLES,
  HAZARD_TYPES,
  HAZARD_EVENT_STATES,
  CAP_SEVERITIES,
} from './index';

describe('@nexus/shared constants', () => {
  it('has the five geography levels', () => {
    expect(PLACE_LEVELS).toEqual([
      'country',
      'region',
      'district',
      'constituency',
      'community',
    ]);
  });

  it('encodes the current Ghana admin counts', () => {
    expect(GHANA_REGION_COUNT).toBe(16);
    expect(GHANA_DISTRICT_COUNT).toBe(261);
  });

  it('defines the ten RBAC roles', () => {
    expect(ROLES).toHaveLength(10);
    expect(ROLES).toContain('community_moderator');
  });

  it('registers the launch hazards and CAP model', () => {
    for (const h of ['flood', 'heavy_rainfall', 'bushfire', 'disease_outbreak', 'drought']) {
      expect(HAZARD_TYPES).toContain(h);
    }
    expect(HAZARD_EVENT_STATES).toContain('warning');
    expect(CAP_SEVERITIES).toEqual(['minor', 'moderate', 'severe', 'extreme']);
  });
});
