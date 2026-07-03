import { describe, it, expect } from 'vitest';
import { classifyRainfall } from './rainfall';

describe('classifyRainfall', () => {
  it('maps 24h rainfall to severity thresholds', () => {
    expect(classifyRainfall(60).severity).toBe('severe');
    expect(classifyRainfall(35).severity).toBe('moderate');
    expect(classifyRainfall(20).severity).toBe('minor');
    expect(classifyRainfall(5).severity).toBeNull(); // below advisory
  });

  it('produces a bounded risk score and echoes rainfall', () => {
    const c = classifyRainfall(80);
    expect(c.riskScore).toBe(1);
    expect(classifyRainfall(40).riskScore).toBe(0.5);
    expect(c.factors.rainfall_mm_24h).toBe(80);
  });
});
