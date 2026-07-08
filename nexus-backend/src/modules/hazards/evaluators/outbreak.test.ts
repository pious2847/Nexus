import { describe, it, expect } from 'vitest';
import { computeBaseline, zScore, classifyOutbreak } from './outbreak';

describe('computeBaseline', () => {
  it('computes mean and population stdDev of trailing weekly counts', () => {
    const b = computeBaseline([2, 4, 4, 4, 5, 5, 7, 9]);
    expect(b.mean).toBe(5);
    expect(b.stdDev).toBe(2);
  });

  it('returns zero mean/stdDev for an empty baseline', () => {
    const b = computeBaseline([]);
    expect(b.mean).toBe(0);
    expect(b.stdDev).toBe(0);
  });

  it('returns zero stdDev for a constant series', () => {
    const b = computeBaseline([3, 3, 3, 3]);
    expect(b.mean).toBe(3);
    expect(b.stdDev).toBe(0);
  });
});

describe('zScore', () => {
  it('computes a standard z-score against a non-degenerate baseline', () => {
    expect(zScore(9, { mean: 5, stdDev: 2 })).toBe(2);
    expect(zScore(5, { mean: 5, stdDev: 2 })).toBe(0);
    expect(zScore(1, { mean: 5, stdDev: 2 })).toBe(-2);
  });

  it('treats a current count above a flat (stdDev=0) baseline as a strong signal', () => {
    expect(zScore(3, { mean: 0, stdDev: 0 })).toBe(99);
    expect(zScore(1, { mean: 1, stdDev: 0 })).toBe(0); // not above the flat baseline
    expect(zScore(0, { mean: 0, stdDev: 0 })).toBe(0);
  });
});

describe('classifyOutbreak', () => {
  it('is null below the alert threshold', () => {
    expect(classifyOutbreak(1.9, 2)).toBeNull();
  });

  it('maps the first sigma-width band above threshold to minor', () => {
    expect(classifyOutbreak(2, 2)).toBe('minor');
    expect(classifyOutbreak(2.9, 2)).toBe('minor');
  });

  it('maps the second sigma-width band to moderate', () => {
    expect(classifyOutbreak(3, 2)).toBe('moderate');
    expect(classifyOutbreak(3.9, 2)).toBe('moderate');
  });

  it('maps two-or-more sigma past threshold to severe', () => {
    expect(classifyOutbreak(4, 2)).toBe('severe');
    expect(classifyOutbreak(99, 2)).toBe('severe');
  });

  it('respects a per-disease alertSigma other than the default', () => {
    expect(classifyOutbreak(1.4, 1.5)).toBeNull();
    expect(classifyOutbreak(1.5, 1.5)).toBe('minor');
    expect(classifyOutbreak(3.5, 1.5)).toBe('severe');
  });
});
