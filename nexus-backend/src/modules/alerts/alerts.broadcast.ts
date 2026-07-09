/**
 * Pure formatting for the last-mile "human network" channel (spec 02 N6) —
 * a longer, read-aloud-friendly script for a radio announcer or a community
 * focal person to relay verbally (door-to-door, gong-gong, loud-hailer), and
 * a printable notice-board sheet. Unlike SMS/WhatsApp, these are written to
 * be SPOKEN or POSTED, not read silently on a screen, so they repeat the key
 * facts and spell out who issued the alert.
 */
import type { CapSeverity } from '@nexus/shared';

export interface BroadcastAlertInput {
  headline: string;
  description?: string | null;
  instruction?: string | null;
  areaDesc?: string | null;
  severity: CapSeverity;
}

/** A script a radio announcer can read verbatim, or a focal person can paraphrase door-to-door. */
export function formatAlertBroadcastScript(a: BroadcastAlertInput): string {
  const area = a.areaDesc ?? 'your area';
  const lines = [
    `OFFICIAL NEXUS DISASTER ALERT for ${area}.`,
    a.headline,
    a.description ?? null,
    a.instruction ? `What to do: ${a.instruction}` : null,
    `Please share this with your neighbors, especially anyone without a phone or radio.`,
    `This has been an official ${a.severity} alert. Repeat: ${a.headline}`,
  ].filter((l): l is string => !!l);
  return lines.join(' ');
}

export interface NoticeSheetInput extends BroadcastAlertInput {
  alertId: string;
  publishedAt: string | null;
}

/** Simple, self-contained HTML for printing/posting on a physical community notice board. */
export function formatNoticeSheetHtml(a: NoticeSheetInput): string {
  const ref = a.alertId.slice(0, 8).toUpperCase();
  const published = a.publishedAt ? new Date(a.publishedAt).toLocaleString('en-GB', { timeZone: 'UTC' }) + ' UTC' : 'Not yet published';
  return `
<!DOCTYPE html><html><head><meta charset="utf-8"><title>NEXUS Alert Notice — ${ref}</title>
<style>
  body { font-family: Arial, sans-serif; max-width: 700px; margin: 40px auto; padding: 0 20px; }
  h1 { font-size: 28px; border-bottom: 4px solid #C62828; padding-bottom: 12px; }
  .severity { display: inline-block; background: #C62828; color: #fff; padding: 4px 14px; border-radius: 4px;
    font-size: 14px; text-transform: uppercase; letter-spacing: 1px; }
  .headline { font-size: 22px; font-weight: bold; margin: 20px 0 10px; }
  .body { font-size: 18px; line-height: 1.5; }
  .instruction { font-size: 18px; font-weight: bold; background: #FFF3E0; padding: 12px; border-left: 6px solid #EF6C00; margin: 20px 0; }
  .footer { margin-top: 30px; font-size: 13px; color: #666; border-top: 1px solid #ccc; padding-top: 10px; }
  @media print { body { margin: 0; } }
</style></head>
<body>
  <span class="severity">${a.severity.toUpperCase()}</span>
  <h1>NEXUS Official Disaster Alert</h1>
  <div class="headline">${a.headline}</div>
  ${a.areaDesc ? `<p><strong>Area:</strong> ${a.areaDesc}</p>` : ''}
  ${a.description ? `<p class="body">${a.description}</p>` : ''}
  ${a.instruction ? `<div class="instruction">${a.instruction}</div>` : ''}
  <div class="footer">
    Reference: ${ref} &middot; Published: ${published}<br>
    Post this notice in a visible public place. Share with anyone who doesn't have a phone.
  </div>
</body></html>`.trim();
}
