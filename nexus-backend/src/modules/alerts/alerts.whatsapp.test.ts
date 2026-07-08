import { describe, it, expect } from 'vitest';
import { formatAlertWhatsapp } from './alerts.whatsapp';

describe('formatAlertWhatsapp', () => {
  it('combines headline and instruction with a prefix', () => {
    const msg = formatAlertWhatsapp({ headline: 'Flood severe — Northern', instruction: 'Move to higher ground.' });
    expect(msg).toBe('🚨 NEXUS ALERT\n\nFlood severe — Northern\n\nMove to higher ground.');
  });

  it('uses just the headline when there is no instruction', () => {
    expect(formatAlertWhatsapp({ headline: 'Bushfire watch — Tamale' })).toBe('🚨 NEXUS ALERT\n\nBushfire watch — Tamale');
  });

  it('truncates with an ellipsis when over the 4096-char limit', () => {
    const msg = formatAlertWhatsapp({ headline: 'X'.repeat(100), instruction: 'Y'.repeat(5000) });
    expect(msg.length).toBe(4096);
    expect(msg.endsWith('…')).toBe(true);
  });

  it('does not truncate realistic-length alerts', () => {
    const msg = formatAlertWhatsapp({ headline: 'Drought watch — Upper West', instruction: 'Conserve water; report dry wells to your district officer.' });
    expect(msg.length).toBeLessThan(4096);
    expect(msg.endsWith('…')).toBe(false);
  });
});
