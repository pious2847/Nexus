import { describe, it, expect } from 'vitest';
import { computeInitialConfidence, corroborationConfidence, applyReputationDelta } from './reports.trust';

describe('computeInitialConfidence', () => {
  it('scales with reputation and is bounded 0.30–0.60', () => {
    expect(computeInitialConfidence(0)).toBe(0.3);
    expect(computeInitialConfidence(100)).toBe(0.6);
    expect(computeInitialConfidence(50)).toBe(0.45);
    expect(computeInitialConfidence(9999)).toBe(0.6); // clamped
    expect(computeInitialConfidence(-10)).toBe(0.3); // clamped
  });
});

describe('corroborationConfidence', () => {
  it('rises with cluster size and caps at 0.95', () => {
    expect(corroborationConfidence(1)).toBe(0.4);
    expect(corroborationConfidence(2)).toBe(0.55);
    expect(corroborationConfidence(3)).toBe(0.7);
    expect(corroborationConfidence(10)).toBe(0.95); // capped
  });
});

describe('applyReputationDelta', () => {
  it('rewards verification and penalises rejection, floored at 0', () => {
    expect(applyReputationDelta(10, 'verified')).toBe(15);
    expect(applyReputationDelta(10, 'rejected')).toBe(8);
    expect(applyReputationDelta(1, 'rejected')).toBe(0); // floor
  });
});
