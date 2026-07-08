import { describe, it, expect } from 'vitest';
import { generateKeyPairSync } from 'crypto';
import { canonicalJson, signCapPayload, verifyCapSignature } from './alerts.signing';

function makeTestKeys(keyId = 'test-key') {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    keyId,
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  };
}

describe('canonicalJson', () => {
  it('produces identical output regardless of key insertion order', () => {
    const a = { b: 2, a: 1, c: { z: 1, y: 2 } };
    const b = { a: 1, c: { y: 2, z: 1 }, b: 2 };
    expect(canonicalJson(a)).toBe(canonicalJson(b));
  });

  it('sorts keys inside array elements too', () => {
    const a = { list: [{ b: 1, a: 2 }] };
    const b = { list: [{ a: 2, b: 1 }] };
    expect(canonicalJson(a)).toBe(canonicalJson(b));
  });
});

describe('signCapPayload / verifyCapSignature', () => {
  const cap = { identifier: 'abc-123', info: { headline: 'Flood severe — Tolon', severity: 'Severe' } };

  it('a genuine signature verifies successfully', () => {
    const keys = makeTestKeys();
    const { signature } = signCapPayload(cap, keys);
    expect(verifyCapSignature(cap, signature, keys.publicKeyPem)).toBe(true);
  });

  it('rejects a tampered payload (any field change invalidates the signature)', () => {
    const keys = makeTestKeys();
    const { signature } = signCapPayload(cap, keys);
    const tampered = { ...cap, info: { ...cap.info, severity: 'Minor' } }; // attacker downgrades severity
    expect(verifyCapSignature(tampered, signature, keys.publicKeyPem)).toBe(false);
  });

  it('rejects a signature from a different key (spoofed sender)', () => {
    const realKeys = makeTestKeys('real');
    const attackerKeys = makeTestKeys('attacker');
    const { signature } = signCapPayload(cap, attackerKeys);
    expect(verifyCapSignature(cap, signature, realKeys.publicKeyPem)).toBe(false);
  });

  it('rejects a garbage signature string rather than throwing', () => {
    const keys = makeTestKeys();
    expect(verifyCapSignature(cap, 'not-valid-base64-signature', keys.publicKeyPem)).toBe(false);
  });
});
