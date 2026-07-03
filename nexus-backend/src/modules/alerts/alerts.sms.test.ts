import { describe, it, expect } from 'vitest';
import { formatAlertSms } from './alerts.sms';

describe('formatAlertSms', () => {
  it('combines headline and instruction under the limit', () => {
    const sms = formatAlertSms({ headline: 'Flood severe — Northern', instruction: 'Move to higher ground.' });
    expect(sms).toBe('NEXUS ALERT: Flood severe — Northern. Move to higher ground.');
    expect(sms.length).toBeLessThanOrEqual(160);
  });

  it('uses just the headline when there is no instruction', () => {
    expect(formatAlertSms({ headline: 'Bushfire watch — Tamale' })).toBe('NEXUS ALERT: Bushfire watch — Tamale');
  });

  it('truncates with an ellipsis at exactly 160 chars when too long', () => {
    const sms = formatAlertSms({ headline: 'X'.repeat(50), instruction: 'Y'.repeat(200) });
    expect(sms.length).toBe(160);
    expect(sms.endsWith('…')).toBe(true);
  });

  it('never exceeds 160 chars even at the boundary', () => {
    const sms = formatAlertSms({ headline: 'A'.repeat(147) }); // "NEXUS ALERT: " (13) + 147 = 160 exactly
    expect(sms.length).toBe(160);
    expect(sms.endsWith('…')).toBe(false); // fits exactly, no truncation needed
  });
});
