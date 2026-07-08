import { describe, it, expect } from 'vitest';
import { isSosCommand, parseSosCommand, buildSosHelpText, buildSosConfirmationText, buildSosUnresolvedText } from './sos-sms.parser';

describe('isSosCommand', () => {
  it('recognizes SOS case-insensitively', () => {
    expect(isSosCommand('SOS, Tolon')).toBe(true);
    expect(isSosCommand('sos, tolon')).toBe(true);
    expect(isSosCommand('SOS')).toBe(true);
  });

  it('does not misclassify REPORT or check-in commands, or empty text', () => {
    expect(isSosCommand('REPORT FLOOD, Tolon, water rising')).toBe(false);
    expect(isSosCommand('SAFE, Tolon')).toBe(false);
    expect(isSosCommand('')).toBe(false);
  });
});

describe('parseSosCommand', () => {
  it('parses a well-formed SOS with notes', () => {
    const r = parseSosCommand('SOS, Tolon, Trapped by flood water');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.placeText).toBe('Tolon');
      expect(r.notes).toBe('Trapped by flood water');
    }
  });

  it('parses an SOS with just a place, no notes', () => {
    const r = parseSosCommand('SOS, Tolon');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.placeText).toBe('Tolon');
      expect(r.notes).toBeNull();
    }
  });

  it('is case-insensitive and trims whitespace', () => {
    const r = parseSosCommand('  sos ,  tolon  ,  help  ');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.placeText).toBe('tolon');
  });

  it('rejects empty input', () => {
    expect(parseSosCommand('')).toEqual({ ok: false, reason: 'empty message' });
  });

  it('rejects a bare "SOS" with no place (a location is required — the schema has no place-less SOS)', () => {
    expect(parseSosCommand('SOS')).toMatchObject({ ok: false, reason: expect.stringContaining('missing place') });
  });

  it('rejects a blank place', () => {
    expect(parseSosCommand('SOS, ')).toMatchObject({ ok: false, reason: 'place is required' });
  });

  it('rejects non-SOS commands', () => {
    expect(parseSosCommand('HELP, Tolon')).toEqual({ ok: false, reason: 'must start with SOS' });
  });
});

describe('buildSosHelpText / buildSosConfirmationText / buildSosUnresolvedText', () => {
  it('help text documents the grammar', () => {
    expect(buildSosHelpText()).toContain('SOS, <place>, <what is happening>');
  });

  it('confirmation text names the resolved place and reassures responders were alerted', () => {
    const msg = buildSosConfirmationText('Tolon');
    expect(msg).toContain('near Tolon');
    expect(msg).toContain('Responders have been alerted');
  });

  it('unresolved text urgently asks for a retry, framed as an emergency', () => {
    const msg = buildSosUnresolvedText('Atlantis');
    expect(msg).toContain('EMERGENCY');
    expect(msg).toContain('Atlantis');
  });
});
