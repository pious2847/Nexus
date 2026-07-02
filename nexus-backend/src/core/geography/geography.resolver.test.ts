import { describe, it, expect } from 'vitest';
import { normalizeDistrictName, levenshtein, DistrictResolver, type DistrictRef } from './geography.resolver';

describe('normalizeDistrictName', () => {
  it('strips category words and punctuation', () => {
    expect(normalizeDistrictName('Tamale Metropolitan')).toBe('tamale');
    expect(normalizeDistrictName('Tamale Metro')).toBe('tamale');
    expect(normalizeDistrictName('Yendi Municipal')).toBe('yendi');
    expect(normalizeDistrictName('Tolon')).toBe('tolon');
  });
  it('keeps directional/qualifier words that distinguish districts', () => {
    expect(normalizeDistrictName('Nanumba North')).toBe('nanumba north');
    expect(normalizeDistrictName('Sekyere Central')).toBe('sekyere central');
  });
});

describe('levenshtein', () => {
  it('measures edit distance', () => {
    expect(levenshtein('sagnarigu', 'sagnerigu')).toBe(1);
    expect(levenshtein('tolon', 'tolon')).toBe(0);
    expect(levenshtein('northern', 'nanton')).toBeGreaterThan(1);
  });
});

describe('DistrictResolver', () => {
  // A fixture mirroring the real Northern-region place names.
  const districts: DistrictRef[] = [
    { id: 'd-tamale', name: 'Tamale Metropolitan' },
    { id: 'd-yendi', name: 'Yendi Municipal' },
    { id: 'd-tolon', name: 'Tolon' },
    { id: 'd-kumbungu', name: 'Kumbungu' },
    { id: 'd-sagnerigu', name: 'Sagnerigu' },
    { id: 'd-savelugu', name: 'Savelugu' },
    { id: 'd-karaga', name: 'Karaga' },
    { id: 'd-nanton', name: 'Nanton' },
    { id: 'd-nanumba-n', name: 'Nanumba North' },
  ];
  const r = new DistrictResolver(districts);

  it('resolves category-suffix variants exactly', () => {
    expect(r.resolve('Tamale Metro')?.placeId).toBe('d-tamale');
    expect(r.resolve('Yendi')?.placeId).toBe('d-yendi');
    expect(r.resolve('Tolon')?.matchType).toBe('exact');
  });

  it('resolves spelling variants fuzzily', () => {
    const res = r.resolve('Sagnarigu');
    expect(res?.placeId).toBe('d-sagnerigu');
    expect(res?.matchType).toBe('fuzzy');
    expect(res?.distance).toBe(1);
  });

  it('returns null for region names / non-districts', () => {
    expect(r.resolve('Northern')).toBeNull();
  });

  it('returns null for unknown input', () => {
    expect(r.resolve('Atlantis')).toBeNull();
  });
});
