/**
 * Orchestrates an inbound SMS into an "I'm Safe" check-in: parse the command
 * -> resolve the place -> record the check-in -> send a confirmation SMS.
 * Mirrors modules/reports/sms/report-sms.service.ts's shape (decoupled from
 * Express, fully testable without an HTTP layer).
 */
import { sendSms as defaultSendSms, type SmsResult } from '../../../integrations/arkesel';
import type { GeographyService } from '../../../core/geography/geography.service';
import type { SafetyCheckinService } from '../checkin.service';
import { parseCheckinCommand, buildCheckinHelpText, buildCheckinConfirmationText } from './checkin-sms.parser';

type SmsSender = (to: string, message: string) => Promise<SmsResult>;

export interface HandleInboundCheckinDeps {
  checkins: SafetyCheckinService;
  geography: GeographyService;
  sendSms?: SmsSender;
}

export interface HandleInboundCheckinResult {
  handled: boolean; // false if the message didn't parse as a check-in command (help text was sent)
  checkinId?: string;
  placeResolved: boolean;
  replyText: string;
}

export async function handleInboundSmsCheckin(deps: HandleInboundCheckinDeps, from: string, text: string): Promise<HandleInboundCheckinResult> {
  const sendSms = deps.sendSms ?? defaultSendSms;
  const parsed = parseCheckinCommand(text);

  if (!parsed.ok) {
    const replyText = buildCheckinHelpText();
    await sendSms(from, replyText);
    return { handled: false, placeResolved: false, replyText };
  }

  const resolved = await deps.geography.resolveDistrict(parsed.placeText);
  if (!resolved) {
    // Unlike incident reports, a check-in with an unresolvable place is not useful
    // (there's nothing to aggregate it into) — ask the sender to retry rather than
    // silently recording a place-less check-in.
    const replyText = `NEXUS: Could not recognize "${parsed.placeText}" as a place. Please retry: SAFE, <your district>.`;
    await sendSms(from, replyText);
    return { handled: false, placeResolved: false, replyText };
  }

  const checkin = await deps.checkins.checkIn({
    placeId: resolved.placeId,
    status: parsed.status,
    subjectName: parsed.subjectName,
    reporterPhone: from,
    source: 'sms',
  });

  const replyText = buildCheckinConfirmationText(parsed.status, resolved.name, parsed.subjectName);
  await sendSms(from, replyText);

  return { handled: true, checkinId: checkin.id, placeResolved: true, replyText };
}
