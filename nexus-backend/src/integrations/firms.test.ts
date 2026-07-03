import { describe, it, expect } from 'vitest';
import { parseFirmsCsv, isHighConfidence } from './firms';

const CSV = `country_id,latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,confidence,version,bright_ti5,frp,daynight
GHA,9.4008,-0.8393,320.1,0.5,0.4,2026-07-02,1312,N,h,2.0NRT,290.2,45.6,D
GHA,9.4100,-0.8500,310.0,0.5,0.4,2026-07-02,1312,N,n,2.0NRT,285.0,12.3,D
GHA,bad,-0.83,,,,,,,l,,,,`;

describe('parseFirmsCsv', () => {
  it('parses valid rows and skips malformed coordinates', () => {
    const pts = parseFirmsCsv(CSV);
    expect(pts).toHaveLength(2);
    expect(pts[0]).toMatchObject({ lat: 9.4008, lng: -0.8393, confidence: 'h', frp: 45.6 });
    expect(pts[1].confidence).toBe('n');
  });

  it('returns [] for empty/headized input', () => {
    expect(parseFirmsCsv('')).toEqual([]);
    expect(parseFirmsCsv('latitude,longitude')).toEqual([]);
  });
});

describe('isHighConfidence', () => {
  it('handles VIIRS letters and MODIS numbers', () => {
    expect(isHighConfidence({ lat: 0, lng: 0, confidence: 'h', frp: null, brightness: null })).toBe(true);
    expect(isHighConfidence({ lat: 0, lng: 0, confidence: 'n', frp: null, brightness: null })).toBe(false);
    expect(isHighConfidence({ lat: 0, lng: 0, confidence: 85, frp: null, brightness: null })).toBe(true);
    expect(isHighConfidence({ lat: 0, lng: 0, confidence: 40, frp: null, brightness: null })).toBe(false);
  });
});
