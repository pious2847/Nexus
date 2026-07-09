import { describe, it, expect } from 'vitest';
import { bearingDegrees, compassPoint, distanceMeters, computeHeading } from './bearing';

describe('bearingDegrees', () => {
  it('is 0 (north) when the destination is directly north', () => {
    expect(bearingDegrees({ lng: 0, lat: 0 }, { lng: 0, lat: 1 })).toBeCloseTo(0, 0);
  });
  it('is ~90 (east) when the destination is directly east', () => {
    expect(bearingDegrees({ lng: 0, lat: 0 }, { lng: 1, lat: 0 })).toBeCloseTo(90, 0);
  });
  it('is ~180 (south) when the destination is directly south', () => {
    expect(bearingDegrees({ lng: 0, lat: 0 }, { lng: 0, lat: -1 })).toBeCloseTo(180, 0);
  });
});

describe('compassPoint', () => {
  it('maps 0 to N', () => {
    expect(compassPoint(0)).toBe('N');
  });
  it('maps 90 to E', () => {
    expect(compassPoint(90)).toBe('E');
  });
  it('maps 180 to S', () => {
    expect(compassPoint(180)).toBe('S');
  });
  it('wraps 360 back to N', () => {
    expect(compassPoint(360)).toBe('N');
  });
});

describe('distanceMeters', () => {
  it('is 0 for identical points', () => {
    expect(distanceMeters({ lng: -0.8, lat: 9.4 }, { lng: -0.8, lat: 9.4 })).toBe(0);
  });
  it('matches a known ~111km per degree of latitude at the equator', () => {
    const d = distanceMeters({ lng: 0, lat: 0 }, { lng: 0, lat: 1 });
    expect(d).toBeGreaterThan(110_000);
    expect(d).toBeLessThan(112_000);
  });
});

describe('computeHeading', () => {
  it('combines bearing, compass point, and distance', () => {
    const h = computeHeading({ lng: 0, lat: 0 }, { lng: 1, lat: 0 });
    expect(h.compassPoint).toBe('E');
    expect(h.bearingDegrees).toBeCloseTo(90, 0);
    expect(h.distanceMeters).toBeGreaterThan(0);
  });
});
