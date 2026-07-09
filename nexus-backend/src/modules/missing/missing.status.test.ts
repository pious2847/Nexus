import { describe, it, expect } from 'vitest';
import {
  isValidMissingStatus,
  isResolvedMissingStatus,
  MISSING_PERSON_STATUSES,
  RESOLVED_MISSING_PERSON_STATUSES,
  type MissingPersonStatus,
} from './missing.status';

describe('isValidMissingStatus', () => {
  it('accepts every documented enum member', () => {
    for (const s of MISSING_PERSON_STATUSES) {
      expect(isValidMissingStatus(s)).toBe(true);
    }
  });

  it('rejects unknown / malformed values', () => {
    expect(isValidMissingStatus('')).toBe(false);
    expect(isValidMissingStatus('MISSING')).toBe(false);
    expect(isValidMissingStatus('resolved')).toBe(false);
    expect(isValidMissingStatus('found ')).toBe(false);
  });
});

describe('isResolvedMissingStatus', () => {
  it('treats found/reunified/closed as resolved', () => {
    for (const s of RESOLVED_MISSING_PERSON_STATUSES) {
      expect(isResolvedMissingStatus(s)).toBe(true);
    }
  });

  it('does not treat missing as resolved', () => {
    expect(isResolvedMissingStatus('missing' as MissingPersonStatus)).toBe(false);
  });
});
