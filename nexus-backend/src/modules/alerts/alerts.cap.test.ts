import { describe, it, expect } from 'vitest';
import { requiredPublishPermission, toCapJson } from './alerts.cap';

describe('requiredPublishPermission (tiered authority)', () => {
  it('maps severity to the required publish permission', () => {
    expect(requiredPublishPermission('extreme')).toBe('alert.publish.extreme');
    expect(requiredPublishPermission('severe')).toBe('alert.publish.severe');
    expect(requiredPublishPermission('moderate')).toBe('alert.publish.watch');
    expect(requiredPublishPermission('minor')).toBe('alert.publish.advisory');
  });
});

describe('toCapJson', () => {
  it('produces CAP 1.2-shaped output with capitalised enums', () => {
    const cap = toCapJson({
      id: 'abc',
      category: 'Met',
      eventType: 'Flood',
      severity: 'severe',
      urgency: 'expected',
      certainty: 'likely',
      headline: 'Flood warning — Northern',
      description: 'Heavy rain expected',
      instruction: 'Move to higher ground',
      areaDesc: 'Northern',
      sentAt: new Date('2026-07-03T00:00:00Z'),
    });
    expect(cap.identifier).toBe('abc');
    expect(cap.msgType).toBe('Alert');
    expect(cap.info.severity).toBe('Severe');
    expect(cap.info.urgency).toBe('Expected');
    expect(cap.info.certainty).toBe('Likely');
    expect(cap.info.event).toBe('Flood');
    expect(cap.info.area).toEqual({ areaDesc: 'Northern' });
    expect(cap.sent).toBe('2026-07-03T00:00:00.000Z');
  });

  it('omits optional fields when absent', () => {
    const cap = toCapJson({
      id: 'x', category: 'Fire', eventType: 'Bushfire', severity: 'minor',
      urgency: 'future', certainty: 'possible', headline: 'h',
    });
    expect(cap.info.area).toBeUndefined();
    expect(cap.info.instruction).toBeUndefined();
  });
});
