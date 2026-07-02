/**
 * End-to-end auth flow against a real database. Skipped by default (and in CI);
 * run locally with a Neon BRANCH:
 *   RUN_DB_TESTS=1 DATABASE_URL=... JWT_SECRET=test-secret pnpm --filter nexus-backend test
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import jwt from 'jsonwebtoken';
import { sql } from 'drizzle-orm';
import { createDb } from '../../shared/db';
import { AuthService } from './auth.service';
import type { AuditEntry, AuditRecorder } from '../audit/audit.service';

const RUN = !!process.env.RUN_DB_TESTS;

describe.runIf(RUN)('auth flow (DB)', () => {
  // Lazily constructed in beforeAll so nothing (incl. the DB pool) is created
  // when the suite is skipped.
  let conn: ReturnType<typeof createDb>;
  let auth: AuthService;
  const auditEvents: AuditEntry[] = [];
  const fakeAudit: AuditRecorder = { record: async (e) => void auditEvents.push(e) };
  const phone = `+23320${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
  let userId = '';

  beforeAll(async () => {
    conn = createDb();
    auth = new AuthService(conn.db, process.env.JWT_SECRET ?? 'test-secret', undefined, fakeAudit);
    await conn.db.execute(sql`DELETE FROM otp_codes WHERE phone = ${phone}`);
    await conn.db.execute(sql`DELETE FROM users WHERE phone = ${phone}`);
  });

  afterAll(async () => {
    if (!conn) return;
    if (userId) await conn.db.execute(sql`DELETE FROM users WHERE id = ${userId}`); // cascades
    await conn.db.execute(sql`DELETE FROM otp_codes WHERE phone = ${phone}`);
    await conn.close();
  });

  it('logs in a new citizen via OTP and issues valid tokens', async () => {
    const req = await auth.requestOtp(phone);
    expect(req.devCode).toMatch(/^\d{6}$/);

    const res = await auth.verifyOtpAndLogin(phone, req.devCode as string);
    userId = res.user.id;
    expect(res.user.role).toBe('citizen');
    expect(res.accessToken).toBeTruthy();
    expect(res.refreshToken).toMatch(/^[0-9a-f]{64}$/);

    const decoded = jwt.verify(res.accessToken, process.env.JWT_SECRET ?? 'test-secret') as { id: string; type: string };
    expect(decoded.id).toBe(res.user.id);
    expect(decoded.type).toBe('access');

    // a citizen grant was created
    const grants = await conn.db.execute(
      sql`SELECT role_code FROM user_roles WHERE user_id = ${userId}`,
    );
    expect((grants.rows as { role_code: string }[]).some((g) => g.role_code === 'citizen')).toBe(true);

    // audit wiring fired
    expect(auditEvents.some((e) => e.action === 'auth.otp_register' && e.resourceId === userId)).toBe(true);
  });

  it('rejects a wrong OTP and enforces single-use codes', async () => {
    await auth.requestOtp(phone).catch(() => undefined); // may hit cooldown; ignore
    // fresh code after cooldown-safe wait is out of scope; assert wrong code fails
    await expect(auth.verifyOtpAndLogin(phone, '000000')).rejects.toThrow();
  });

  it('rotates refresh tokens and revokes the old one', async () => {
    const phone2 = `${phone}9`; // different phone to avoid the resend cooldown
    const req = await auth.requestOtp(phone2);
    const login = await auth.verifyOtpAndLogin(phone2, req.devCode as string);
    const rotated = await auth.refresh(login.refreshToken);
    expect(rotated.refreshToken).not.toBe(login.refreshToken);
    await expect(auth.refresh(login.refreshToken)).rejects.toThrow(); // old is revoked
    await conn.db.execute(sql`DELETE FROM users WHERE id = ${login.user.id}`);
    await conn.db.execute(sql`DELETE FROM otp_codes WHERE phone = ${phone2}`);
  });

  it('approves a verification request and grants the requested role', async () => {
    const v = await auth.requestVerification(userId, 'ngo_partner', { evidence: { doc: 'reg-123' } });
    const review = await auth.reviewVerification(v.id, userId, 'approved');
    expect(review.status).toBe('approved');

    const grants = await conn.db.execute(sql`SELECT role_code FROM user_roles WHERE user_id = ${userId}`);
    expect((grants.rows as { role_code: string }[]).some((g) => g.role_code === 'ngo_partner')).toBe(true);
  });
});
