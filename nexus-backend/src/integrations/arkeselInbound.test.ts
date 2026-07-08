import { describe, it, expect } from 'vitest';
import { normalizeArkeselInboundPayload } from './arkeselInbound';

describe('normalizeArkeselInboundPayload', () => {
  it('accepts an already-normalized { from, text } body', () => {
    expect(normalizeArkeselInboundPayload({ from: '+233201234567', text: 'REPORT FLOOD, TOLON, water rising' })).toEqual({
      from: '+233201234567',
      text: 'REPORT FLOOD, TOLON, water rising',
    });
  });

  it('accepts common alias field names defensively (sender/message, msisdn/sms, phone/body)', () => {
    expect(normalizeArkeselInboundPayload({ sender: '+233201234567', message: 'hi' })).toEqual({ from: '+233201234567', text: 'hi' });
    expect(normalizeArkeselInboundPayload({ msisdn: '+233201234567', sms: 'hi' })).toEqual({ from: '+233201234567', text: 'hi' });
    expect(normalizeArkeselInboundPayload({ phone: '+233201234567', body: 'hi' })).toEqual({ from: '+233201234567', text: 'hi' });
  });

  it('rejects non-object, empty, or incomplete payloads without throwing', () => {
    expect(normalizeArkeselInboundPayload(null)).toBeNull();
    expect(normalizeArkeselInboundPayload('a string')).toBeNull();
    expect(normalizeArkeselInboundPayload({})).toBeNull();
    expect(normalizeArkeselInboundPayload({ from: '+233201234567' })).toBeNull(); // no text field found
    expect(normalizeArkeselInboundPayload({ text: 'hi' })).toBeNull(); // no from field found
  });

  it('ignores blank/whitespace-only field values', () => {
    expect(normalizeArkeselInboundPayload({ from: '   ', text: 'hi' })).toBeNull();
  });
});
