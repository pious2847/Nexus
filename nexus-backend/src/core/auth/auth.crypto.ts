/**
 * Pure crypto helpers for auth — no DB, no framework, unit-testable.
 * OTPs are stored as salted hashes; refresh tokens are high-entropy opaque
 * strings stored as hashes (so a DB leak never exposes usable tokens).
 */
import { createHash, randomBytes, randomInt } from 'node:crypto';

/** A 6-digit numeric OTP (zero-padded). */
export function generateOtpCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

/** Hash an OTP with a server pepper (JWT secret) so codes aren't stored plainly. */
export function hashOtp(code: string, pepper: string): string {
  return createHash('sha256').update(`${pepper}:${code}`).digest('hex');
}

/** A 256-bit opaque refresh token (hex). */
export function generateRefreshToken(): string {
  return randomBytes(32).toString('hex');
}

/** Hash a refresh token for storage/lookup. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
