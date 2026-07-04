import { describe, it, expect } from 'vitest';
import { percentile, classifyFloodRisk } from './flood';

describe('percentile', () => {
  it('computes standard percentiles with linear interpolation', () => {
    const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(percentile(values, 50)).toBeCloseTo(5.5, 1);
    expect(percentile(values, 90)).toBeCloseTo(9.1, 1);
    expect(percentile(values, 0)).toBe(1);
    expect(percentile(values, 100)).toBe(10);
  });

  it('is insensitive to input order', () => {
    expect(percentile([5, 1, 3, 2, 4], 50)).toBe(percentile([1, 2, 3, 4, 5], 50));
  });

  it('returns 0 for an empty array', () => {
    expect(percentile([], 90)).toBe(0);
  });
});

describe('classifyFloodRisk', () => {
  it('classifies by percentile threshold crossed', () => {
    expect(classifyFloodRisk(120, 50, 80, 100).severity).toBe('severe'); // >= p98
    expect(classifyFloodRisk(90, 50, 80, 100).severity).toBe('moderate'); // >= p95
    expect(classifyFloodRisk(60, 50, 80, 100).severity).toBe('minor'); // >= p90
    expect(classifyFloodRisk(30, 50, 80, 100).severity).toBeNull(); // below p90
  });

  it('echoes the inputs', () => {
    const cls = classifyFloodRisk(75, 50, 80, 100);
    expect(cls).toMatchObject({ currentMax: 75, p90: 50, p95: 80, p98: 100 });
  });
});
