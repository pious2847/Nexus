/**
 * Phone-OTP auth endpoints, mounted at /api/v1/auth-v2 (alongside the legacy
 * email/password /api/v1/auth). Input validated with Zod.
 */
import { Router } from 'express';
import { z } from 'zod';
import type { CoreServices } from '../http/container';

const phoneSchema = z.object({ phone: z.string().min(8).max(20) });
const verifySchema = z.object({ phone: z.string().min(8).max(20), code: z.string().regex(/^\d{6}$/) });
const refreshSchema = z.object({ refreshToken: z.string().min(16) });

export function buildAuthRouter({ auth }: CoreServices): Router {
  const router = Router();

  router.post('/otp/request', async (req, res) => {
    const parsed = phoneSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ success: false, message: 'Valid phone required' });
    try {
      const result = await auth.requestOtp(parsed.data.phone);
      return res.json({ success: true, data: result });
    } catch (err) {
      return res.status(429).json({ success: false, message: (err as Error).message });
    }
  });

  router.post('/otp/verify', async (req, res) => {
    const parsed = verifySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ success: false, message: 'phone and 6-digit code required' });
    try {
      const ctx = { ip: req.ip, userAgent: req.get('user-agent') ?? undefined };
      const result = await auth.verifyOtpAndLogin(parsed.data.phone, parsed.data.code, ctx);
      return res.json({ success: true, message: 'Login successful', data: result });
    } catch (err) {
      return res.status(401).json({ success: false, message: (err as Error).message });
    }
  });

  router.post('/refresh', async (req, res) => {
    const parsed = refreshSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ success: false, message: 'refreshToken required' });
    try {
      const ctx = { ip: req.ip, userAgent: req.get('user-agent') ?? undefined };
      return res.json({ success: true, data: await auth.refresh(parsed.data.refreshToken, ctx) });
    } catch (err) {
      return res.status(401).json({ success: false, message: (err as Error).message });
    }
  });

  router.post('/logout', async (req, res) => {
    const parsed = refreshSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ success: false, message: 'refreshToken required' });
    await auth.revoke(parsed.data.refreshToken);
    return res.json({ success: true, message: 'Logged out' });
  });

  return router;
}
