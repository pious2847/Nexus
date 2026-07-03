/**
 * CAP (Common Alerting Protocol) helpers — pure + unit-tested (ADR-0008).
 * We store CAP fields on the alert and can serialize a CAP-shaped JSON payload
 * for interoperability (e.g. GMet/NADMO, cell broadcast) and multi-channel delivery.
 */
import type { CapSeverity, Permission } from '@nexus/shared';

/** Which permission is required to publish an alert of a given severity (tiered authority, spec §11). */
export function requiredPublishPermission(severity: CapSeverity): Permission {
  switch (severity) {
    case 'extreme':
      return 'alert.publish.extreme';
    case 'severe':
      return 'alert.publish.severe';
    case 'moderate':
      return 'alert.publish.watch';
    case 'minor':
    default:
      return 'alert.publish.advisory';
  }
}

export interface CapInput {
  id: string;
  category: string;
  eventType: string;
  severity: string;
  urgency: string;
  certainty: string;
  headline: string;
  description?: string | null;
  instruction?: string | null;
  areaDesc?: string | null;
  sentAt?: Date;
}

/** Serialize to a CAP-shaped JSON object (CAP 1.2 field names). */
export function toCapJson(a: CapInput) {
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1); // minor -> Minor
  return {
    identifier: a.id,
    sender: 'nexus.gov.gh',
    sent: (a.sentAt ?? new Date()).toISOString(),
    status: 'Actual',
    msgType: 'Alert',
    scope: 'Public',
    info: {
      category: a.category,
      event: a.eventType,
      urgency: cap(a.urgency),
      severity: cap(a.severity),
      certainty: cap(a.certainty),
      headline: a.headline,
      description: a.description ?? undefined,
      instruction: a.instruction ?? undefined,
      area: a.areaDesc ? { areaDesc: a.areaDesc } : undefined,
    },
  };
}
