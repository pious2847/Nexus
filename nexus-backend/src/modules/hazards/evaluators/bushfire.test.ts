import { describe, it, expect } from 'vitest';
import { classifyBushfire } from './bushfire';

describe('classifyBushfire', () => {
  it('is severe on high FRP or many high-confidence detections', () => {
    expect(classifyBushfire({ count: 1, highConf: 0, maxFrp: 60 }).severity).toBe('severe');
    expect(classifyBushfire({ count: 3, highConf: 3, maxFrp: 10 }).severity).toBe('severe');
  });

  it('is moderate for several detections or one high-confidence', () => {
    expect(classifyBushfire({ count: 3, highConf: 0, maxFrp: 10 }).severity).toBe('moderate');
    expect(classifyBushfire({ count: 1, highConf: 1, maxFrp: 5 }).severity).toBe('moderate');
  });

  it('is minor for a single low-confidence detection', () => {
    expect(classifyBushfire({ count: 1, highConf: 0, maxFrp: 5 }).severity).toBe('minor');
  });

  it('produces bounded risk/confidence and echoes factors', () => {
    const c = classifyBushfire({ count: 4, highConf: 2, maxFrp: 80 });
    expect(c.riskScore).toBeGreaterThan(0);
    expect(c.riskScore).toBeLessThanOrEqual(1);
    expect(c.confidence).toBeLessThanOrEqual(1);
    expect(c.factors).toEqual({ count: 4, highConfidence: 2, maxFrp: 80 });
  });
});
