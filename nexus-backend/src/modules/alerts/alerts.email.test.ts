import { describe, it, expect } from 'vitest';
import { formatAlertEmail } from './alerts.email';

describe('formatAlertEmail', () => {
  it('builds a subject, html, and plaintext body from all fields', () => {
    const email = formatAlertEmail({
      headline: 'Flood severe — Northern',
      description: 'River discharge exceeds the 10-year threshold.',
      instruction: 'Move to higher ground.',
      severity: 'severe',
      areaDesc: 'Tolon District',
    });
    expect(email.subject).toBe('NEXUS ALERT: Flood severe — Northern');
    expect(email.html).toContain('Flood severe — Northern');
    expect(email.html).toContain('Tolon District');
    expect(email.html).toContain('Move to higher ground.');
    expect(email.html).toContain('#EF6C00'); // severe severity color
    expect(email.text).toBe('Flood severe — Northern\n\nRiver discharge exceeds the 10-year threshold.\n\nMove to higher ground.');
  });

  it('omits missing optional fields cleanly', () => {
    const email = formatAlertEmail({ headline: 'Bushfire watch — Tamale', severity: 'minor' });
    expect(email.text).toBe('Bushfire watch — Tamale');
    expect(email.html).not.toContain('Area:');
  });
});
