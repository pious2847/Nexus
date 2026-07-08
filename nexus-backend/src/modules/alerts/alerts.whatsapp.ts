/**
 * Pure WhatsApp formatting for warnings — unit-tested. WhatsApp text messages
 * allow up to 4096 chars (Meta Cloud API), far more than SMS, so unlike
 * formatAlertSms this doesn't need aggressive truncation — headline and full
 * instruction both fit comfortably in virtually every real case.
 */
const WHATSAPP_MAX = 4096;

export interface WhatsappAlertInput {
  headline: string;
  instruction?: string | null;
}

export function formatAlertWhatsapp(a: WhatsappAlertInput): string {
  const prefix = '🚨 NEXUS ALERT\n\n';
  const body = a.instruction ? `${a.headline}\n\n${a.instruction}` : a.headline;
  const full = prefix + body;
  if (full.length <= WHATSAPP_MAX) return full;
  return full.slice(0, WHATSAPP_MAX - 1).trimEnd() + '…';
}
