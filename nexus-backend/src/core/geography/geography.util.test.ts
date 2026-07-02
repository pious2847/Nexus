import { describe, it, expect } from 'vitest';
import { slugify, buildPath } from './geography.util';

describe('geography.util', () => {
  it('slugifies names into ltree-safe segments', () => {
    expect(slugify('Greater Accra')).toBe('greater_accra');
    expect(slugify('Western North')).toBe('western_north');
    expect(slugify('Ablekuma Central Municipal')).toBe('ablekuma_central_municipal');
    expect(slugify("Kpone Katamanso  ")).toBe('kpone_katamanso');
  });

  it('builds hierarchical paths', () => {
    expect(buildPath('', 'Ghana')).toBe('ghana');
    expect(buildPath('gh', 'Greater Accra')).toBe('gh.greater_accra');
    expect(buildPath('gh.greater_accra', 'Accra Metropolitan')).toBe(
      'gh.greater_accra.accra_metropolitan',
    );
  });

  it('rejects names that produce empty segments', () => {
    expect(() => buildPath('gh', '!!!')).toThrow();
  });
});
