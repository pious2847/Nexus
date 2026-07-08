/**
 * Orchestrates an inbound SMS into an SOS alert: parse -> resolve place ->
 * resolve a centroid (SMS has no live GPS) -> raise the SOS (which itself
 * fans out SMS+in-app to responders) -> confirmation SMS back to the sender.
 * Mirrors modules/safety/sms/checkin-sms.service.ts's shape.
 */
import { sendSms as defaultSendSms, type SmsResult } from '../../../integrations/arkesel';
import type { GeographyService } from '../../../core/geography/geography.service';
import type { SosService } from '../sos.service';
import { parseSosCommand, buildSosHelpText, buildSosConfirmationText, buildSosUnresolvedText } from './sos-sms.parser';

type SmsSender = (to: string, message: string) => Promise<SmsResult>;

export interface HandleInboundSosDeps {
  sos: SosService;
  geography: GeographyService;
  sendSms?: SmsSender;
}

export interface HandleInboundSosResult {
  handled: boolean;
  sosId?: string;
  placeResolved: boolean;
  replyText: string;
}

export async function handleInboundSmsSos(deps: HandleInboundSosDeps, from: string, text: string): Promise<HandleInboundSosResult> {
  const sendSms = deps.sendSms ?? defaultSendSms;
  const parsed = parseSosCommand(text);

  if (!parsed.ok) {
    const replyText = buildSosHelpText();
    await sendSms(from, replyText);
    return { handled: false, placeResolved: false, replyText };
  }

  const resolved = await deps.geography.resolveDistrict(parsed.placeText);
  if (!resolved) {
    const replyText = buildSosUnresolvedText(parsed.placeText);
    await sendSms(from, replyText);
    return { handled: false, placeResolved: false, replyText };
  }

  const centroid = await deps.sos.centroidForPlace(resolved.placeId);
  if (!centroid) {
    // A resolved district with no centroid geometry (a tracked Phase 0 data gap for
    // a small number of places) — same treatment as unresolved, ask to retry.
    const replyText = buildSosUnresolvedText(parsed.placeText);
    await sendSms(from, replyText);
    return { handled: false, placeResolved: false, replyText };
  }

  const alert = await deps.sos.raise({
    lng: centroid.lng,
    lat: centroid.lat,
    locationPrecision: 'district_centroid',
    notes: parsed.notes,
    reporterPhone: from,
  });

  const replyText = buildSosConfirmationText(resolved.name);
  await sendSms(from, replyText);

  return { handled: true, sosId: alert.id, placeResolved: true, replyText };
}
