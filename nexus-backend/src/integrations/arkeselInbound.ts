/**
 * Normalizes an inbound-SMS webhook payload to `{ from, text }`.
 *
 * ⚠️ HONESTY NOTE: Arkesel's exact inbound-SMS webhook field names are not
 * publicly documented as of this writing — their two-way messaging product is
 * "KOVA IQ", a separate unified inbox, not a plainly-documented webhook on the
 * core SMS API. This function defensively accepts several field-name aliases
 * that are common across SMS providers (Arkesel's own OUTBOUND API uses
 * `sender`/`sms`-style naming, so those are included), but **the exact shape
 * has not been confirmed against a live Arkesel inbound payload**. When a
 * dedicated/short-code inbound number is provisioned, capture one real
 * payload and update this function to match precisely — it's the only file
 * that needs to change.
 *
 * Also accepts an already-normalized `{ from, text }` body directly, so the
 * intake endpoint works today with any provider (or our own tests) without
 * waiting on that confirmation.
 */
export interface NormalizedInboundSms {
  from: string;
  text: string;
}

function firstString(...candidates: unknown[]): string | null {
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) return c.trim();
  }
  return null;
}

export function normalizeArkeselInboundPayload(raw: unknown): NormalizedInboundSms | null {
  if (!raw || typeof raw !== 'object') return null;
  const b = raw as Record<string, unknown>;

  const from = firstString(b.from, b.sender, b.msisdn, b.phone, b.recipient);
  const text = firstString(b.text, b.message, b.sms, b.body, b.content);

  if (!from || !text) return null;
  return { from, text };
}
