import { describe, it, expect } from 'vitest';
import { formatAlertBroadcastScript, formatNoticeSheetHtml } from './alerts.broadcast';

describe('formatAlertBroadcastScript', () => {
  it('builds a read-aloud script with area, headline, description, instruction, and a repeated headline', () => {
    const script = formatAlertBroadcastScript({
      headline: 'Flood severe — Tolon',
      description: 'River discharge exceeds the 10-year threshold.',
      instruction: 'Move to higher ground immediately.',
      areaDesc: 'Tolon District',
      severity: 'severe',
    });
    expect(script).toContain('OFFICIAL NEXUS DISASTER ALERT for Tolon District.');
    expect(script).toContain('Flood severe — Tolon');
    expect(script).toContain('River discharge exceeds the 10-year threshold.');
    expect(script).toContain('What to do: Move to higher ground immediately.');
    expect(script).toContain('share this with your neighbors');
    expect(script).toContain('Repeat: Flood severe — Tolon');
  });

  it('omits missing optional fields cleanly and defaults the area', () => {
    const script = formatAlertBroadcastScript({ headline: 'Bushfire watch — Tamale', severity: 'minor' });
    expect(script).toContain('for your area.');
    expect(script).not.toContain('What to do:');
    expect(script).not.toContain('null');
  });
});

describe('formatNoticeSheetHtml', () => {
  it('renders a printable notice with severity, headline, area, instruction, and a short reference', () => {
    const html = formatNoticeSheetHtml({
      alertId: '12345678-abcd-ef00-0000-000000000000',
      publishedAt: '2026-07-08T22:00:00.000Z',
      headline: 'Flood severe — Tolon',
      description: 'River discharge exceeds the 10-year threshold.',
      instruction: 'Move to higher ground.',
      areaDesc: 'Tolon District',
      severity: 'severe',
    });
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('SEVERE');
    expect(html).toContain('Flood severe — Tolon');
    expect(html).toContain('Tolon District');
    expect(html).toContain('Move to higher ground.');
    expect(html).toContain('12345678');
  });

  it('shows "Not yet published" for a draft (no published_at)', () => {
    const html = formatNoticeSheetHtml({
      alertId: '12345678-abcd-ef00-0000-000000000000',
      publishedAt: null,
      headline: 'Bushfire watch — Tamale',
      severity: 'minor',
    });
    expect(html).toContain('Not yet published');
  });
});
