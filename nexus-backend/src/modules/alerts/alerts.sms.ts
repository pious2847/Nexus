/**
 * Pure SMS formatting for warnings — unit-tested. Standard SMS is 160 GSM-7
 * chars per segment; we keep to one segment for reliability/cost and truncate
 * with an ellipsis rather than silently dropping the instruction.
 */
const SMS_MAX = 160;

export interface SmsAlertInput {
  headline: string;
  instruction?: string | null;
}

export function formatAlertSms(a: SmsAlertInput): string {
  const prefix = 'NEXUS ALERT: ';
  const body = a.instruction ? `${a.headline}. ${a.instruction}` : a.headline;
  const full = prefix + body;
  if (full.length <= SMS_MAX) return full;
  return full.slice(0, SMS_MAX - 1).trimEnd() + '…';
}
