/**
 * Inbound SMS webhook, mounted at /api/v1/sms-intake. Handles citizen
 * incident reports (REPORT ...), "I'm Safe" check-ins (SAFE/HELP/INJURED
 * ...), and SOS alerts (SOS ...) — a real SMS provider posts every inbound
 * message to one URL regardless of content, so routing by keyword happens
 * here rather than having three separate webhook endpoints. SOS is checked
 * first (an emergency keyword should never be shadowed by a broader match).
 *
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
import { isCheckinCommand } from '../../safety/sms/checkin-sms.parser';
import { handleInboundSmsCheckin } from '../../safety/sms/checkin-sms.service';
import { isSosCommand } from '../../safety/sms/sos-sms.parser';
import { handleInboundSmsSos } from '../../safety/sms/sos-sms.service';

export function buildReportSmsRouter({ reports, geography, safetyCheckins, sos }: CoreServices): Router {
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
      const result = isSosCommand(normalized.text)
        ? await handleInboundSmsSos({ sos, geography }, normalized.from, normalized.text)
        : isCheckinCommand(normalized.text)
          ? await handleInboundSmsCheckin({ checkins: safetyCheckins, geography }, normalized.from, normalized.text)
          : await handleInboundSmsReport({ reports, geography }, normalized.from, normalized.text);
      res.status(200).json({ success: true, data: result });
    } catch (err) {
      console.error('[sms-intake] failed to process inbound SMS:', (err as Error).message);
      res.status(200).json({ success: false, message: 'Internal error processing the report' });
    }
  });

  return router;
}
