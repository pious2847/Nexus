/**
 * Data access for auth: OTP codes, users (by phone), refresh tokens, and the
 * account-verification workflow. All SQL for auth lives here (CONTRIBUTING §3).
 */
import { sql } from 'drizzle-orm';
import type { Db } from '../../shared/db';

export interface DbUser {
  id: string;
  name: string | null;
  email: string | null;
  role: string | null;
  phone: string | null;
  status: string | null;
}

// ── OTP ──────────────────────────────────────────────────────────────────────
export async function insertOtp(
  db: Db,
  a: { phone: string; codeHash: string; purpose: string; expiresAt: Date },
): Promise<void> {
  await db.execute(sql`
    INSERT INTO otp_codes (phone, code_hash, purpose, expires_at)
    VALUES (${a.phone}, ${a.codeHash}, ${a.purpose}, ${a.expiresAt})
  `);
}

export async function recentOtpCount(db: Db, phone: string, withinSeconds: number): Promise<number> {
  const r = await db.execute(sql`
    SELECT count(*)::int AS n FROM otp_codes
    WHERE phone = ${phone} AND consumed_at IS NULL
      AND created_at > now() - make_interval(secs => ${withinSeconds})
  `);
  return (r.rows[0] as { n: number }).n;
}

export interface OtpRow { id: string; code_hash: string; attempts: number }
export async function latestValidOtp(db: Db, phone: string, purpose: string): Promise<OtpRow | null> {
  const r = await db.execute(sql`
    SELECT id, code_hash, attempts FROM otp_codes
    WHERE phone = ${phone} AND purpose = ${purpose} AND consumed_at IS NULL AND expires_at > now()
    ORDER BY created_at DESC LIMIT 1
  `);
  return (r.rows[0] as unknown as OtpRow) ?? null;
}

export async function incrementOtpAttempts(db: Db, id: string): Promise<void> {
  await db.execute(sql`UPDATE otp_codes SET attempts = attempts + 1 WHERE id = ${id}`);
}
export async function consumeOtp(db: Db, id: string): Promise<void> {
  await db.execute(sql`UPDATE otp_codes SET consumed_at = now() WHERE id = ${id}`);
}

// ── Users ────────────────────────────────────────────────────────────────────
export async function findUserByPhone(db: Db, phone: string): Promise<DbUser | null> {
  const r = await db.execute(sql`SELECT id, name, email, role, phone, status FROM users WHERE phone = ${phone} LIMIT 1`);
  return (r.rows[0] as unknown as DbUser) ?? null;
}

export async function findUserById(db: Db, id: string): Promise<DbUser | null> {
  const r = await db.execute(sql`SELECT id, name, email, role, phone, status FROM users WHERE id = ${id} LIMIT 1`);
  return (r.rows[0] as unknown as DbUser) ?? null;
}

/** Create a phone-only citizen and grant the citizen role. */
export async function createCitizenByPhone(db: Db, phone: string): Promise<DbUser> {
  const r = await db.execute(sql`
    INSERT INTO users (name, phone, role, status, preferred_language)
    VALUES (${phone}, ${phone}, 'citizen', 'active', 'en')
    RETURNING id, name, email, role, phone, status
  `);
  const user = r.rows[0] as unknown as DbUser;
  await db.execute(sql`
    INSERT INTO user_roles (user_id, role_code, place_id) VALUES (${user.id}, 'citizen', NULL)
    ON CONFLICT DO NOTHING
  `);
  return user;
}

// ── Refresh tokens ───────────────────────────────────────────────────────────
export async function insertRefreshToken(
  db: Db,
  a: { userId: string; tokenHash: string; expiresAt: Date; userAgent?: string; ip?: string },
): Promise<void> {
  await db.execute(sql`
    INSERT INTO refresh_tokens (user_id, token_hash, expires_at, user_agent, ip)
    VALUES (${a.userId}, ${a.tokenHash}, ${a.expiresAt}, ${a.userAgent ?? null}, ${a.ip ?? null})
  `);
}

export async function findValidRefreshToken(db: Db, tokenHash: string): Promise<{ id: string; user_id: string } | null> {
  const r = await db.execute(sql`
    SELECT id, user_id FROM refresh_tokens
    WHERE token_hash = ${tokenHash} AND revoked_at IS NULL AND expires_at > now() LIMIT 1
  `);
  return (r.rows[0] as unknown as { id: string; user_id: string }) ?? null;
}

export async function revokeRefreshToken(db: Db, tokenHash: string): Promise<void> {
  await db.execute(sql`UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = ${tokenHash}`);
}

// ── Account verification ─────────────────────────────────────────────────────
export async function insertVerification(
  db: Db,
  a: { userId: string; requestedRole: string; orgId?: string; evidence?: unknown },
): Promise<{ id: string }> {
  const r = await db.execute(sql`
    INSERT INTO account_verifications (user_id, requested_role, org_id, evidence)
    VALUES (${a.userId}, ${a.requestedRole}, ${a.orgId ?? null}, ${JSON.stringify(a.evidence ?? {})}::jsonb)
    RETURNING id
  `);
  return r.rows[0] as unknown as { id: string };
}

export interface VerificationRow { id: string; user_id: string; requested_role: string; status: string }
export async function getVerification(db: Db, id: string): Promise<VerificationRow | null> {
  const r = await db.execute(sql`SELECT id, user_id, requested_role, status FROM account_verifications WHERE id = ${id}`);
  return (r.rows[0] as unknown as VerificationRow) ?? null;
}

export async function updateVerificationStatus(
  db: Db,
  a: { id: string; status: string; reviewedBy: string },
): Promise<void> {
  await db.execute(sql`
    UPDATE account_verifications SET status = ${a.status}, reviewed_by = ${a.reviewedBy}, reviewed_at = now()
    WHERE id = ${a.id}
  `);
}

export async function grantRole(
  db: Db,
  a: { userId: string; roleCode: string; placeId?: string },
): Promise<void> {
  await db.execute(sql`
    INSERT INTO user_roles (user_id, role_code, place_id) VALUES (${a.userId}, ${a.roleCode}, ${a.placeId ?? null})
    ON CONFLICT DO NOTHING
  `);
}
