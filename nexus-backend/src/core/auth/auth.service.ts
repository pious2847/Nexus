/**
 * Auth service — phone-OTP login, refresh-token rotation, and the account
 * verification workflow. Complements (does not replace) the existing
 * email/password login. Issues access tokens compatible with the current
 * `authenticate` middleware.
 */
import type { Db } from '../../shared/db';
import { sendSms } from '../../integrations/arkesel';
import { generateOtpCode, generateRefreshToken, hashOtp, hashToken } from './auth.crypto';
import { signAccessToken } from './auth.tokens';
import * as repo from './auth.repository';
import type { DbUser } from './auth.repository';
import type { AuditRecorder } from '../audit/audit.service';

const OTP_TTL_MS = 5 * 60 * 1000;
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const OTP_RESEND_COOLDOWN_S = 30;
const OTP_MAX_ATTEMPTS = 5;

export interface RequestContext {
  userAgent?: string;
  ip?: string;
}
export interface Tokens {
  accessToken: string;
  refreshToken: string;
}

export class AuthService {
  constructor(
    private readonly db: Db,
    private readonly secret: string = process.env.JWT_SECRET ?? '',
    private readonly accessTtl: string = process.env.JWT_EXPIRES_IN || '1h',
    private readonly audit?: AuditRecorder,
  ) {
    if (!this.secret) throw new Error('JWT_SECRET is not set');
  }

  /** Generate + send a login OTP. In non-production, returns the code for testing. */
  async requestOtp(phone: string, purpose: 'login' | 'verify' = 'login') {
    if ((await repo.recentOtpCount(this.db, phone, OTP_RESEND_COOLDOWN_S)) > 0) {
      throw new Error('Please wait before requesting another code');
    }
    const code = generateOtpCode();
    const expiresAt = new Date(Date.now() + OTP_TTL_MS);
    await repo.insertOtp(this.db, { phone, codeHash: hashOtp(code, this.secret), purpose, expiresAt });
    const sms = await sendSms(phone, `Your NEXUS verification code is ${code}. It expires in 5 minutes.`);
    return {
      sent: sms.sent,
      expiresAt,
      devCode: process.env.NODE_ENV !== 'production' ? code : undefined,
    };
  }

  /** Verify a login OTP; find-or-create the citizen; issue tokens. */
  async verifyOtpAndLogin(phone: string, code: string, ctx?: RequestContext): Promise<{ user: DbUser } & Tokens> {
    const otp = await repo.latestValidOtp(this.db, phone, 'login');
    if (!otp) throw new Error('Invalid or expired code');
    if (otp.attempts >= OTP_MAX_ATTEMPTS) throw new Error('Too many attempts — request a new code');
    if (hashOtp(code, this.secret) !== otp.code_hash) {
      await repo.incrementOtpAttempts(this.db, otp.id);
      throw new Error('Invalid code');
    }
    await repo.consumeOtp(this.db, otp.id);

    const existing = await repo.findUserByPhone(this.db, phone);
    const user = existing ?? (await repo.createCitizenByPhone(this.db, phone));
    const tokens = await this.issueTokens(user, ctx);
    await this.audit?.record({
      actorId: user.id,
      action: existing ? 'auth.otp_login' : 'auth.otp_register',
      resourceType: 'user',
      resourceId: user.id,
      ip: ctx?.ip ?? null,
    });
    return { user, ...tokens };
  }

  private async issueTokens(user: DbUser, ctx?: RequestContext): Promise<Tokens> {
    const accessToken = signAccessToken(user, this.secret, this.accessTtl);
    const refreshToken = generateRefreshToken();
    await repo.insertRefreshToken(this.db, {
      userId: user.id,
      tokenHash: hashToken(refreshToken),
      expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
      userAgent: ctx?.userAgent,
      ip: ctx?.ip,
    });
    return { accessToken, refreshToken };
  }

  /** Rotate a refresh token: revoke the old, issue a fresh pair. */
  async refresh(refreshToken: string, ctx?: RequestContext): Promise<Tokens> {
    const hash = hashToken(refreshToken);
    const row = await repo.findValidRefreshToken(this.db, hash);
    if (!row) throw new Error('Invalid or expired refresh token');
    await repo.revokeRefreshToken(this.db, hash);
    const user = await repo.findUserById(this.db, row.user_id);
    if (!user) throw new Error('User not found');
    return this.issueTokens(user, ctx);
  }

  async revoke(refreshToken: string): Promise<void> {
    await repo.revokeRefreshToken(this.db, hashToken(refreshToken));
  }

  // ── Account verification (vetting) ─────────────────────────────────────────
  async requestVerification(
    userId: string,
    requestedRole: string,
    opts?: { orgId?: string; evidence?: unknown },
  ): Promise<{ id: string }> {
    return repo.insertVerification(this.db, { userId, requestedRole, orgId: opts?.orgId, evidence: opts?.evidence });
  }

  /** Approve/reject a verification; approval grants the requested (optionally scoped) role. */
  async reviewVerification(
    id: string,
    reviewerId: string,
    decision: 'approved' | 'rejected',
    opts?: { placeId?: string },
  ): Promise<{ id: string; status: string }> {
    const v = await repo.getVerification(this.db, id);
    if (!v) throw new Error('Verification not found');
    await repo.updateVerificationStatus(this.db, { id, status: decision, reviewedBy: reviewerId });
    if (decision === 'approved') {
      await repo.grantRole(this.db, { userId: v.user_id, roleCode: v.requested_role, placeId: opts?.placeId });
    }
    await this.audit?.record({
      actorId: reviewerId,
      action: 'auth.verification_reviewed',
      resourceType: 'account_verification',
      resourceId: id,
      placeId: opts?.placeId ?? null,
      metadata: { decision, requestedRole: v.requested_role, subject: v.user_id },
    });
    return { id, status: decision };
  }
}
