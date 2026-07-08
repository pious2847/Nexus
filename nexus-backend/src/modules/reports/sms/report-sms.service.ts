/**
 * Orchestrates an inbound SMS into a citizen incident report: parse the
 * command → resolve the place → submit the report → send a confirmation SMS.
 * Deliberately decoupled from Express (takes a normalized `{ from, text }` and
 * injected dependencies) so it's fully testable without an HTTP layer.
 */
import { sendSms as defaultSendSms, type SmsResult } from '../../../integrations/arkesel';
import type { GeographyService } from '../../../core/geography/geography.service';
import type { ReportsService } from '../reports.service';
import { parseSmsReportCommand, buildHelpText, buildConfirmationText } from './report-sms.parser';

type SmsSender = (to: string, message: string) => Promise<SmsResult>;

export interface HandleInboundSmsDeps {
  reports: ReportsService;
  geography: GeographyService;
  sendSms?: SmsSender;
}

export interface HandleInboundSmsResult {
  handled: boolean; // false if the message didn't parse as a report command (help text was sent)
  reportId?: string;
  placeResolved: boolean;
  replyText: string;
}

/** Build a report title from the free-text description (first line, truncated). */
function titleFromDescription(description: string): string {
  const firstLine = description.split(/\r?\n/)[0].trim();
  return (firstLine || 'Incident reported via SMS').slice(0, 120);
}

export async function handleInboundSmsReport(deps: HandleInboundSmsDeps, from: string, text: string): Promise<HandleInboundSmsResult> {
  const sendSms = deps.sendSms ?? defaultSendSms;
  const parsed = parseSmsReportCommand(text);

  if (!parsed.ok) {
    const replyText = buildHelpText();
    await sendSms(from, replyText);
    return { handled: false, placeResolved: false, replyText };
  }

  const resolved = await deps.geography.resolveDistrict(parsed.placeText);
  const report = await deps.reports.submit(
    {
      hazardType: parsed.hazardType,
      placeId: resolved?.placeId ?? null,
      title: titleFromDescription(parsed.description),
      description: parsed.description,
      source: 'sms',
      reporterPhone: from,
    },
    null, // no authenticated user — anonymous/phone-only SMS reporter
  );

  const replyText = buildConfirmationText(resolved?.name ?? null, report.id);
  await sendSms(from, replyText);

  return { handled: true, reportId: report.id, placeResolved: !!resolved, replyText };
}
