/**
 * Pure email formatting for warnings — unit-tested. Simple, self-contained
 * HTML (no external template engine) so this module has no new dependencies.
 */
import type { CapSeverity } from '@nexus/shared';

const SEVERITY_COLOR: Record<CapSeverity, string> = {
  minor: '#2E7D32',
  moderate: '#F9A825',
  severe: '#EF6C00',
  extreme: '#C62828',
};

export interface EmailAlertInput {
  headline: string;
  description?: string | null;
  instruction?: string | null;
  severity: CapSeverity;
  areaDesc?: string | null;
}

export interface FormattedEmailAlert {
  subject: string;
  html: string;
  text: string;
}

export function formatAlertEmail(a: EmailAlertInput): FormattedEmailAlert {
  const color = SEVERITY_COLOR[a.severity];
  const subject = `NEXUS ALERT: ${a.headline}`;
  const textParts = [a.headline, a.description, a.instruction].filter((p): p is string => !!p);
  const text = textParts.join('\n\n');
  const html = `
<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;background:#f5f5f5;margin:0;padding:20px">
<div style="max-width:600px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.1)">
  <div style="background:${color};padding:20px;text-align:center">
    <h1 style="color:#fff;margin:0;font-size:20px">N.E.X.U.S. Alert</h1>
    <span style="background:rgba(255,255,255,0.2);color:#fff;padding:4px 12px;border-radius:12px;font-size:12px;text-transform:uppercase">${a.severity}</span>
  </div>
  <div style="padding:24px">
    <h2 style="margin-top:0">${a.headline}</h2>
    ${a.areaDesc ? `<p style="color:#666">Area: ${a.areaDesc}</p>` : ''}
    ${a.description ? `<p>${a.description}</p>` : ''}
    ${a.instruction ? `<p style="font-weight:bold">${a.instruction}</p>` : ''}
  </div>
</div>
</body></html>`.trim();
  return { subject, html, text };
}
