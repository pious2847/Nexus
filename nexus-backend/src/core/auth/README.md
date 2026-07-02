# core/auth

New authentication capabilities added in Phase 0 Step 0.5, **alongside** the
existing email/password login (which is untouched):

- **Phone-OTP login** for citizens (Arkesel SMS) — find-or-create a citizen on first login.
- **Refresh tokens** — opaque, hashed at rest, rotated on use.
- **Account verification** — officials/NGOs/researchers request a role; an approver grants it.

## Files
- `auth.crypto.ts` — pure OTP/token hashing (unit-tested).
- `auth.tokens.ts` — access-token signing (payload compatible with existing `authenticate`).
- `auth.repository.ts` — all auth SQL (otp_codes, users-by-phone, refresh_tokens, verifications).
- `auth.service.ts` — the flows: `requestOtp`, `verifyOtpAndLogin`, `refresh`, `revoke`, `requestVerification`, `reviewVerification`.
- `../../integrations/arkesel.ts` — SMS adapter (dev/no-key mode logs instead of failing).
- DDL: `src/db/migrations/0003_auth.sql`.

## Security notes
- OTPs: 6-digit, hashed with a server pepper (JWT secret), 5-min TTL, ≤5 attempts, single-use, 30s resend cooldown.
- Refresh tokens: 256-bit, stored as SHA-256 hashes, rotated (old revoked) on each refresh.
- `requestOtp` returns the code (`devCode`) only when `NODE_ENV !== 'production'` — for local/testing.
- Access tokens stay short-lived (default 1h); refresh tokens live 30 days.

## Verify (DB-gated)
```bash
RUN_DB_TESTS=1 DATABASE_URL=<neon-branch> JWT_SECRET=test-secret \
  pnpm --filter nexus-backend test
```

## Wiring status
The service is ready; HTTP routes + `@types/express` wiring land with the module
migration (Step 0.7). Existing `authenticate`/`requireRole` continue to work unchanged.
