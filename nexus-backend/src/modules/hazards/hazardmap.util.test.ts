import { describe, it, expect } from 'vitest';
import { severityRank, rankToSeverity, severityColor, buildFeature, buildFeatureAllowNullGeometry, toFeatureCollection, NO_RISK_COLOR } from './hazardmap.util';

describe('severityRank / rankToSeverity', () => {
  it('ranks severities in order and is invertible', () => {
    expect(severityRank('minor')).toBe(1);
    expect(severityRank('moderate')).toBe(2);
    expect(severityRank('severe')).toBe(3);
    expect(severityRank('extreme')).toBe(4);
    expect(severityRank(null)).toBe(0);
    expect(severityRank(undefined)).toBe(0);
    for (const s of ['minor', 'moderate', 'severe', 'extreme'] as const) {
      expect(rankToSeverity(severityRank(s))).toBe(s);
    }
    expect(rankToSeverity(0)).toBeNull();
  });
});

describe('severityColor', () => {
  it('returns the neutral color for no active hazard, a real color otherwise', () => {
    expect(severityColor(null)).toBe(NO_RISK_COLOR);
    expect(severityColor('extreme')).not.toBe(NO_RISK_COLOR);
    expect(severityColor('extreme')).toMatch(/^#/);
  });
});

describe('buildFeature', () => {
  it('parses a geometry JSON string into a Feature', () => {
    const f = buildFeature('{"type":"Point","coordinates":[1,2]}', { id: 'x' });
    expect(f).toEqual({ type: 'Feature', geometry: { type: 'Point', coordinates: [1, 2] }, properties: { id: 'x' } });
  });

  it('returns null for missing or malformed geometry', () => {
    expect(buildFeature(null, {})).toBeNull();
    expect(buildFeature(undefined, {})).toBeNull();
    expect(buildFeature('not json', {})).toBeNull();
  });
});

describe('buildFeatureAllowNullGeometry', () => {
  it('marks hasGeometry:true and preserves geometry when present', () => {
    const f = buildFeatureAllowNullGeometry('{"type":"Point","coordinates":[1,2]}', { name: 'X' });
    expect(f.geometry).toEqual({ type: 'Point', coordinates: [1, 2] });
    expect(f.properties).toMatchObject({ name: 'X', hasGeometry: true });
  });

  it('returns a Feature with geometry:null instead of dropping the row when geometry is missing', () => {
    const f = buildFeatureAllowNullGeometry(null, { name: 'Guan' });
    expect(f.type).toBe('Feature');
    expect(f.geometry).toBeNull();
    expect(f.properties).toMatchObject({ name: 'Guan', hasGeometry: false });
  });
});

describe('toFeatureCollection', () => {
  it('filters out nulls and reports an accurate count', () => {
    const f1 = buildFeature('{"type":"Point","coordinates":[0,0]}', {});
    const fc = toFeatureCollection([f1, null, null], { layer: 'test' });
    expect(fc.type).toBe('FeatureCollection');
    expect(fc.features).toHaveLength(1);
    expect(fc.meta.count).toBe(1);
    expect(fc.meta.layer).toBe('test');
  });
});
