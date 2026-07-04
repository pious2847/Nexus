import { describe, it, expect } from 'vitest';
import { sumWindow, deficitPercent, classifyDrought, WINDOW_DAYS } from './drought';

describe('sumWindow', () => {
  it('sums a contiguous window ending at the given date and reports full coverage', () => {
    const byDate = new Map<string, number>([
      ['2026-06-28', 1],
      ['2026-06-29', 2],
      ['2026-06-30', 3],
    ]);
    const r = sumWindow(byDate, '2026-06-30', 3);
    expect(r.total).toBe(6);
    expect(r.coverage).toBe(1);
  });

  it('reports partial coverage when days are missing', () => {
    const byDate = new Map<string, number>([['2026-06-30', 5]]);
    const r = sumWindow(byDate, '2026-06-30', 4);
    expect(r.total).toBe(5);
    expect(r.coverage).toBe(0.25);
  });

  it('handles a completely empty map', () => {
    const r = sumWindow(new Map(), '2026-06-30', WINDOW_DAYS);
    expect(r.total).toBe(0);
    expect(r.coverage).toBe(0);
  });
});

describe('deficitPercent', () => {
  it('computes a bounded percentage deficit', () => {
    expect(deficitPercent(50, 100)).toBe(50);
    expect(deficitPercent(0, 100)).toBe(100);
    expect(deficitPercent(150, 100)).toBe(0); // surplus, clamped at 0 (not negative)
  });

  it('returns 0 when normal is zero or negative (no meaningful signal)', () => {
    expect(deficitPercent(10, 0)).toBe(0);
    expect(deficitPercent(0, 0)).toBe(0);
  });
});

describe('classifyDrought', () => {
  it('maps deficit percentage to severity thresholds', () => {
    expect(classifyDrought(90).severity).toBe('severe');
    expect(classifyDrought(65).severity).toBe('moderate');
    expect(classifyDrought(45).severity).toBe('minor');
    expect(classifyDrought(20).severity).toBeNull();
  });

  it('echoes the deficit percentage', () => {
    expect(classifyDrought(72.5).deficitPercent).toBe(72.5);
  });
});
