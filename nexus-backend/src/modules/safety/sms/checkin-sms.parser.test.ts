import { describe, it, expect } from 'vitest';
import { isCheckinCommand, parseCheckinCommand, buildCheckinHelpText, buildCheckinConfirmationText } from './checkin-sms.parser';

describe('isCheckinCommand', () => {
  it('recognizes SAFE/HELP/INJURED (and aliases) case-insensitively', () => {
    expect(isCheckinCommand('SAFE, Tolon')).toBe(true);
    expect(isCheckinCommand('safe, tolon')).toBe(true);
    expect(isCheckinCommand('HELP, Tolon')).toBe(true);
    expect(isCheckinCommand('INJURED, Tolon')).toBe(true);
    expect(isCheckinCommand('HURT, Tolon')).toBe(true);
  });

  it('does not misclassify a REPORT command or empty text', () => {
    expect(isCheckinCommand('REPORT FLOOD, Tolon, water rising')).toBe(false);
    expect(isCheckinCommand('')).toBe(false);
    expect(isCheckinCommand('   ')).toBe(false);
  });
});

describe('parseCheckinCommand', () => {
  it('parses a self check-in', () => {
    const r = parseCheckinCommand('SAFE, Tolon');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.status).toBe('safe');
      expect(r.placeText).toBe('Tolon');
      expect(r.subjectName).toBeNull();
    }
  });

  it('maps HELP to need_help and INJURED to injured', () => {
    expect((parseCheckinCommand('HELP, Tolon') as { status: string }).status).toBe('need_help');
    expect((parseCheckinCommand('INJURED, Tolon') as { status: string }).status).toBe('injured');
  });

  it('parses an on-behalf-of check-in (community focal person)', () => {
    const r = parseCheckinCommand('SAFE, Tolon, Ama Yeboah');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.subjectName).toBe('Ama Yeboah');
      expect(r.placeText).toBe('Tolon');
    }
  });

  it('is case-insensitive and trims whitespace', () => {
    const r = parseCheckinCommand('  safe ,  tolon  ');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.status).toBe('safe');
      expect(r.placeText).toBe('tolon');
    }
  });

  it('rejects empty input', () => {
    expect(parseCheckinCommand('')).toEqual({ ok: false, reason: 'empty message' });
  });

  it('rejects an unrecognized status word', () => {
    expect(parseCheckinCommand('MAYBE, Tolon')).toMatchObject({ ok: false, reason: expect.stringContaining('SAFE, HELP, or INJURED') });
  });

  it('rejects a missing place', () => {
    expect(parseCheckinCommand('SAFE')).toMatchObject({ ok: false, reason: expect.stringContaining('missing place') });
    expect(parseCheckinCommand('SAFE, ')).toMatchObject({ ok: false, reason: 'place is required' });
  });
});

describe('buildCheckinHelpText / buildCheckinConfirmationText', () => {
  it('help text documents the grammar', () => {
    expect(buildCheckinHelpText()).toContain('SAFE, <place>');
  });

  it('confirmation text reflects self vs. on-behalf-of, and the status', () => {
    expect(buildCheckinConfirmationText('safe', 'Tolon', null)).toContain('You marked SAFE in Tolon');
    expect(buildCheckinConfirmationText('need_help', 'Tolon', null)).toContain('NEEDING HELP');
    expect(buildCheckinConfirmationText('injured', 'Tolon', 'Ama Yeboah')).toContain('Ama Yeboah marked INJURED in Tolon');
  });
});
