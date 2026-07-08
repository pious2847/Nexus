import { describe, it, expect } from 'vitest';
import { parseSmsReportCommand, resolveHazardAlias, buildHelpText, buildConfirmationText } from './report-sms.parser';

describe('resolveHazardAlias', () => {
  it('maps friendly words to hazard codes, case-insensitively', () => {
    expect(resolveHazardAlias('flood')).toBe('flood');
    expect(resolveHazardAlias('FIRE')).toBe('bushfire');
    expect(resolveHazardAlias('Rain')).toBe('heavy_rainfall');
    expect(resolveHazardAlias('cholera')).toBe('disease_outbreak');
  });

  it('treats OTHER and empty as "no specific type" (null, not a failure)', () => {
    expect(resolveHazardAlias('OTHER')).toBeNull();
    expect(resolveHazardAlias('')).toBeNull();
  });

  it('returns null for unrecognized words rather than throwing', () => {
    expect(resolveHazardAlias('BANANA')).toBeNull();
  });
});

describe('parseSmsReportCommand', () => {
  it('parses the canonical grammar', () => {
    const r = parseSmsReportCommand('REPORT FLOOD, TOLON, Water rising near the market, road blocked');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.hazardType).toBe('flood');
      expect(r.placeText).toBe('TOLON');
      expect(r.description).toBe('Water rising near the market, road blocked'); // preserves commas after 2nd
    }
  });

  it('is case-insensitive on the REPORT keyword and trims whitespace', () => {
    const r = parseSmsReportCommand('  report fire,  gushegu ,  bush is burning near school  ');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.hazardType).toBe('bushfire');
      expect(r.placeText).toBe('gushegu');
      expect(r.description).toBe('bush is burning near school');
    }
  });

  it('accepts OTHER / unrecognized hazard words as a place-holder (hazardType null)', () => {
    const r = parseSmsReportCommand('REPORT OTHER, Yendi, Something strange happened');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.hazardType).toBeNull();
  });

  it('rejects empty input', () => {
    expect(parseSmsReportCommand('')).toEqual({ ok: false, reason: 'empty message' });
    expect(parseSmsReportCommand('   ')).toEqual({ ok: false, reason: 'empty message' });
  });

  it('rejects non-REPORT commands (e.g. HELP) without throwing', () => {
    const r = parseSmsReportCommand('HELP');
    expect(r).toEqual({ ok: false, reason: 'must start with REPORT' });
  });

  it('rejects missing comma-separated parts', () => {
    expect(parseSmsReportCommand('REPORT FLOOD')).toMatchObject({ ok: false });
    expect(parseSmsReportCommand('REPORT FLOOD, TOLON')).toMatchObject({ ok: false, reason: expect.stringContaining('3 comma-separated') });
  });

  it('rejects a blank place or description', () => {
    expect(parseSmsReportCommand('REPORT FLOOD, , something')).toMatchObject({ ok: false, reason: 'place is required' });
    expect(parseSmsReportCommand('REPORT FLOOD, TOLON, ')).toMatchObject({ ok: false, reason: 'description is required' });
  });

  it('truncates an excessively long description rather than failing', () => {
    const long = 'x'.repeat(2000);
    const r = parseSmsReportCommand(`REPORT FLOOD, TOLON, ${long}`);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.description.length).toBe(1000);
  });
});

describe('buildHelpText / buildConfirmationText', () => {
  it('help text documents the grammar', () => {
    expect(buildHelpText()).toContain('REPORT <type>, <place>, <description>');
  });

  it('confirmation text includes a short reference and the resolved place', () => {
    const msg = buildConfirmationText('Tolon', '12345678-abcd-ef00-0000-000000000000');
    expect(msg).toContain('for Tolon');
    expect(msg).toContain('12345678');
  });

  it('confirmation text flags an unresolved location without failing', () => {
    const msg = buildConfirmationText(null, 'aaaaaaaa-0000-0000-0000-000000000000');
    expect(msg).toContain('location not recognized');
  });
});
