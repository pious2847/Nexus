/**
 * Inbound SMS citizen-reporting webhook, mounted at /api/v1/sms-intake.
 * Public (no user auth — the caller is the SMS provider, not a logged-in
 * user), so it's protected instead by an optional shared-secret query param
 * (SMS_INBOUND_TOKEN). If that env var is unset, the endpoint is open — fine
 * for local dev, but it MUST be set before pointing a real provider at this
 * in production.
 */
import { Router } from 'express';
import type { CoreServices } from '../../../core/http/container';
import { normalizeArkeselInboundPayload } from '../../../integrations/arkeselInbound';
import { handleInboundSmsReport } from './report-sms.service';

export function buildReportSmsRouter({ reports, geography }: CoreServices): Router {
  const router = Router();

  router.post('/inbound', async (req, res) => {
    const expectedToken = process.env.SMS_INBOUND_TOKEN;
    if (expectedToken && req.query.token !== expectedToken) {
      res.status(403).json({ success: false, message: 'Invalid or missing token' });
      return;
    }

    const normalized = normalizeArkeselInboundPayload(req.body);
    if (!normalized) {
      // Still 200 — a malformed webhook retrying forever helps no one, and we
      // have nothing useful to reply to (no confirmed 'from' number).
      res.status(200).json({ success: false, message: 'Could not parse an inbound SMS payload' });
      return;
    }

    try {
      const result = await handleInboundSmsReport({ reports, geography }, normalized.from, normalized.text);
      res.status(200).json({ success: true, data: result });
    } catch (err) {
      console.error('[sms-intake] failed to process inbound SMS:', (err as Error).message);
      res.status(200).json({ success: false, message: 'Internal error processing the report' });
    }
  });

  return router;
}
