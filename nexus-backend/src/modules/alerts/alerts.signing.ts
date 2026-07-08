/**
 * Alert authentication / anti-spoofing (spec 02 N10). Published alerts are
 * signed with an Ed25519 key so the public can independently verify a CAP
 * payload is genuine and untampered — fake disaster alerts cause deadly
 * panic, so authenticity is a safety feature, not a nice-to-have.
 *
 * The signature covers a *canonical* (recursively key-sorted) JSON encoding
 * of the CAP payload, so re-serialization order never breaks verification.
 * Node's built-in crypto (Ed25519) is used — no new dependency.
 */
import { createPrivateKey, createPublicKey, sign as cryptoSign, verify as cryptoVerify } from 'crypto';

/** Recursively sort object keys so JSON.stringify is deterministic regardless of insertion order. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) sorted[key] = sortKeys(obj[key]);
    return sorted;
  }
  return value;
}

export interface SigningKeys {
  keyId: string;
  privateKeyPem: string;
  publicKeyPem: string;
}

/** Reads the signing keypair from env. Returns null if not configured (dev-mode: publish proceeds unsigned). */
export function getSigningKeys(): SigningKeys | null {
  const keyId = process.env.ALERT_SIGNING_KEY_ID;
  const privateKeyPem = process.env.ALERT_SIGNING_PRIVATE_KEY?.replace(/\\n/g, '\n');
  const publicKeyPem = process.env.ALERT_SIGNING_PUBLIC_KEY?.replace(/\\n/g, '\n');
  if (!keyId || !privateKeyPem || !publicKeyPem) return null;
  return { keyId, privateKeyPem, publicKeyPem };
}

export interface CapSignature {
  signature: string; // base64
  keyId: string;
}

/** Sign a CAP payload with the given Ed25519 private key (PEM). */
export function signCapPayload(cap: unknown, keys: Pick<SigningKeys, 'privateKeyPem' | 'keyId'>): CapSignature {
  const data = Buffer.from(canonicalJson(cap), 'utf8');
  const privateKey = createPrivateKey(keys.privateKeyPem);
  // Ed25519/Ed448 use algorithm=null in Node's crypto.sign/verify (hashing is built into the curve).
  const signature = cryptoSign(null, data, privateKey).toString('base64');
  return { signature, keyId: keys.keyId };
}

/** Verify a CAP payload's signature against the given Ed25519 public key (PEM). Never throws. */
export function verifyCapSignature(cap: unknown, signatureBase64: string, publicKeyPem: string): boolean {
  try {
    const data = Buffer.from(canonicalJson(cap), 'utf8');
    const publicKey = createPublicKey(publicKeyPem);
    return cryptoVerify(null, data, publicKey, Buffer.from(signatureBase64, 'base64'));
  } catch {
    return false;
  }
}
