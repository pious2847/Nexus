import { describe, it, expect } from 'vitest';
import { generateOtpCode, hashOtp, generateRefreshToken, hashToken } from './auth.crypto';

describe('auth.crypto', () => {
  it('generates zero-padded 6-digit OTPs', () => {
    for (let i = 0; i < 200; i++) {
      const code = generateOtpCode();
      expect(code).toMatch(/^\d{6}$/);
    }
  });

  it('hashes OTPs deterministically and salted by pepper', () => {
    expect(hashOtp('123456', 'pepperA')).toBe(hashOtp('123456', 'pepperA'));
    expect(hashOtp('123456', 'pepperA')).not.toBe(hashOtp('123456', 'pepperB'));
    expect(hashOtp('123456', 'pepperA')).not.toBe(hashOtp('654321', 'pepperA'));
    expect(hashOtp('123456', 'pepperA')).not.toContain('123456'); // never stores plaintext
  });

  it('generates unique high-entropy refresh tokens and stable hashes', () => {
    const a = generateRefreshToken();
    const b = generateRefreshToken();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(b);
    expect(hashToken(a)).toBe(hashToken(a));
    expect(hashToken(a)).not.toBe(a); // stored hash != token
  });
});
