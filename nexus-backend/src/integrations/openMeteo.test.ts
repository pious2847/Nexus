import { describe, it, expect } from 'vitest';
import { parseDailyPrecip } from './openMeteo';

describe('parseDailyPrecip', () => {
  it('parses daily precipitation and computes the max', () => {
    const json = {
      daily: { time: ['2026-07-03', '2026-07-04'], precipitation_sum: [12.4, 55.1] },
    };
    const f = parseDailyPrecip(json);
    expect(f.days).toHaveLength(2);
    expect(f.days[1]).toEqual({ date: '2026-07-04', precipMm: 55.1 });
    expect(f.maxMm).toBe(55.1);
  });

  it('handles missing/empty data gracefully', () => {
    expect(parseDailyPrecip({}).maxMm).toBe(0);
    expect(parseDailyPrecip({ daily: { time: ['x'], precipitation_sum: [null] } }).days[0].precipMm).toBe(0);
  });
});
