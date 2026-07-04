import { describe, it, expect } from 'vitest';
import { parseDailyDischarge } from './glofas';

describe('parseDailyDischarge', () => {
  it('parses daily discharge and drops null/missing entries', () => {
    const json = { daily: { time: ['2026-07-01', '2026-07-02', '2026-07-03'], river_discharge: [0.5, null, 1.2] } };
    const s = parseDailyDischarge(json);
    expect(s.days).toEqual([
      { date: '2026-07-01', dischargeM3s: 0.5 },
      { date: '2026-07-03', dischargeM3s: 1.2 },
    ]);
  });

  it('handles missing/empty daily block', () => {
    expect(parseDailyDischarge({}).days).toEqual([]);
  });
});
