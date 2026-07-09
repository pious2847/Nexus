/**
 * Alerts service — draft a CAP alert from a hazard event, then publish it under
 * tiered authority (spec §11) and fan out to subscribers of the affected area:
 * in-app notifications (always) plus SMS (spec 02 N9 — guaranteed reach, since
 * in-app alone only reaches citizens with the app open). Push/WhatsApp/voice
 * layer on top of the same fan-out step later.
 */
import type { CapSeverity } from '@nexus/shared';
import type { Db } from '../../shared/db';
import type { AuditRecorder } from '../../core/audit/audit.service';
import type { RbacService } from '../../core/rbac/rbac.service';
import type { NotificationsService } from '../../core/notifications/notifications.service';
import { sendSms as defaultSendSms, type SmsResult } from '../../integrations/arkesel';
import { sendWhatsapp as defaultSendWhatsapp, type WhatsappResult } from '../../integrations/whatsapp';
import { sendEmail as defaultSendEmail, type EmailResult } from '../../integrations/email';
import * as repo from './alerts.repository';
import type { AlertRow } from './alerts.repository';
import { requiredPublishPermission, toCapJson } from './alerts.cap';
import { formatAlertSms } from './alerts.sms';
import { formatAlertWhatsapp } from './alerts.whatsapp';
import { formatAlertEmail } from './alerts.email';
import { formatAlertBroadcastScript, formatNoticeSheetHtml } from './alerts.broadcast';
import { getSigningKeys, signCapPayload, verifyCapSignature } from './alerts.signing';
import type { FocalPointService } from './focal/focal-point.service';

export class PublishForbiddenError extends Error {}

type SmsSender = (to: string, message: string) => Promise<SmsResult>;
type WhatsappSender = (to: string, message: string) => Promise<WhatsappResult>;
type EmailSender = (to: string, subject: string, html: string, text?: string) => Promise<EmailResult>;

export class AlertsService {
  constructor(
    private readonly db: Db,
    private readonly rbac: RbacService,
    private readonly notifications: NotificationsService,
    private readonly audit?: AuditRecorder,
    private readonly sendSms: SmsSender = defaultSendSms,
    private readonly sendWhatsapp: WhatsappSender = defaultSendWhatsapp,
    private readonly sendEmail: EmailSender = defaultSendEmail,
    // Optional (not defaulted, unlike the senders above) — needs a GeographyService to
    // construct, which this class doesn't otherwise receive. If omitted, publish() simply
    // skips the N6 last-mile fan-out rather than failing (same graceful-skip pattern as
    // `audit` and unset signing keys).
    private readonly focalPoints?: FocalPointService,
  ) {}

  getAlert(id: string) {
    return repo.getAlert(this.db, id);
  }
  listAlerts(filter: { status?: string; limit?: number }) {
    return repo.listAlerts(this.db, filter);
  }
  toCap(alert: AlertRow) {
    return toCapJson({
      id: alert.id,
      category: alert.category,
      eventType: alert.event_type,
      severity: alert.severity,
      urgency: alert.urgency,
      certainty: alert.certainty,
      headline: alert.headline,
      description: alert.description,
      instruction: alert.instruction,
      areaDesc: alert.area_desc,
      sentAt: alert.published_at ? new Date(alert.published_at) : undefined,
    });
  }

  /** Draft an alert from a hazard event (status = draft; not yet disseminated). */
  async draftFromEvent(
    eventId: string,
    createdBy: string,
    opts?: { instruction?: string; headline?: string },
  ): Promise<AlertRow> {
    const e = await repo.getEventForAlert(this.db, eventId);
    if (!e) throw new Error('Hazard event not found');
    const severity = (e.severity ?? 'minor') as string;
    const headline = opts?.headline ?? `${e.label} ${severity} — ${e.place_name ?? 'Ghana'}`;

    const alert = await repo.insertAlert(this.db, {
      hazardEventId: eventId,
      placeId: e.place_id,
      category: e.category,
      eventType: e.label,
      severity,
      urgency: e.urgency ?? 'expected',
      certainty: e.certainty ?? 'likely',
      headline,
      instruction: opts?.instruction ?? null,
      areaDesc: e.place_name,
      createdBy,
    });

    await this.audit?.record({
      actorId: createdBy,
      action: 'alert.drafted',
      resourceType: 'alert',
      resourceId: alert.id,
      placeId: e.place_id,
      metadata: { severity, eventId },
    });
    return alert;
  }

  /**
   * Publish an alert under tiered authority, then notify subscribers in the area.
   * Throws PublishForbiddenError if the user lacks the severity-appropriate permission.
   */
  async publish(alertId: string, userId: string): Promise<AlertRow> {
    const alert = await repo.getAlert(this.db, alertId);
    if (!alert) throw new Error('Alert not found');
    if (alert.status === 'published') return alert;

    const permission = requiredPublishPermission(alert.severity as CapSeverity);
    const placePath = alert.place_id ? await repo.placePathById(this.db, alert.place_id) : null;
    if (!(await this.rbac.can(userId, permission, placePath))) {
      throw new PublishForbiddenError(`Requires ${permission} for this area`);
    }

    // Fan out in-app notifications to subscribers of the affected area.
    let recipients = 0;
    if (placePath) {
      const userIds = await repo.findSubscribers(this.db, placePath);
      for (const uid of userIds) {
        await this.notifications.notify({
          userId: uid,
          type: 'alert',
          title: alert.headline,
          body: alert.description ?? undefined,
          data: { alertId: alert.id, severity: alert.severity, hazardEventId: alert.hazard_event_id },
        });
      }
      recipients = userIds.length;
    }

    // Fan out SMS to subscribers who opted in (guaranteed reach — spec 02 N9).
    let smsAttempted = 0;
    let smsDelivered = 0;
    if (placePath) {
      const smsSubscribers = await repo.findSmsSubscribers(this.db, placePath);
      const message = formatAlertSms({ headline: alert.headline, instruction: alert.instruction });
      for (const sub of smsSubscribers) {
        smsAttempted++;
        const result = await this.sendSms(sub.phone, message);
        if (result.sent) smsDelivered++;
      }
    }

    // Fan out WhatsApp to subscribers who opted in. Falls back to dev-mode logging
    // (attempted but not delivered) if WHATSAPP_TOKEN/WHATSAPP_PHONE_NUMBER_ID are
    // unset — see integrations/whatsapp.ts.
    let whatsappAttempted = 0;
    let whatsappDelivered = 0;
    if (placePath) {
      const whatsappSubscribers = await repo.findWhatsappSubscribers(this.db, placePath);
      const message = formatAlertWhatsapp({ headline: alert.headline, instruction: alert.instruction });
      for (const sub of whatsappSubscribers) {
        whatsappAttempted++;
        const result = await this.sendWhatsapp(sub.phone, message);
        if (result.sent) whatsappDelivered++;
      }
    }

    // Fan out email to subscribers who opted in.
    let emailAttempted = 0;
    let emailDelivered = 0;
    if (placePath) {
      const emailSubscribers = await repo.findEmailSubscribers(this.db, placePath);
      const { subject, html, text } = formatAlertEmail({
        headline: alert.headline,
        description: alert.description,
        instruction: alert.instruction,
        severity: alert.severity as CapSeverity,
        areaDesc: alert.area_desc,
      });
      for (const sub of emailSubscribers) {
        emailAttempted++;
        const result = await this.sendEmail(sub.email, subject, html, text);
        if (result.sent) emailDelivered++;
      }
    }

    // Fan out to community focal points — the N6 "last-mile human network" (radio
    // stations, focal persons, notice boards). Not personal subscribers: every active
    // focal point covering the area gets the broadcast script, since their whole job is
    // relaying to people who have no phone/signal at all.
    let focalPointsNotified = 0;
    if (placePath && this.focalPoints) {
      const points = await this.focalPoints.findActiveByScope(placePath);
      const script = formatAlertBroadcastScript({
        headline: alert.headline,
        description: alert.description,
        instruction: alert.instruction,
        areaDesc: alert.area_desc,
        severity: alert.severity as CapSeverity,
      });
      for (const point of points) {
        let delivered = false;
        if (point.contact_phone) {
          const result = await this.sendSms(point.contact_phone, script);
          delivered = delivered || result.sent;
        }
        if (point.contact_email) {
          const result = await this.sendEmail(point.contact_email, `NEXUS Broadcast Alert — ${alert.headline}`, `<pre style="white-space:pre-wrap;font-family:inherit">${script}</pre>`, script);
          delivered = delivered || result.sent;
        }
        if (delivered) focalPointsNotified++;
      }
    }

    await repo.setPublished(this.db, alertId, userId, {
      recipients, smsAttempted, smsDelivered, whatsappAttempted, whatsappDelivered,
      emailAttempted, emailDelivered, focalPointsNotified,
    });

    // Sign the CAP payload (spec 02 N10 — anti-spoofing) now that published_at is set,
    // so the signature covers the same `sent` timestamp a verifier will recompute later.
    // Skipped in dev-mode if no signing key is configured (getSigningKeys() -> null) —
    // never blocks publishing, matching every other channel adapter's fallback pattern.
    const keys = getSigningKeys();
    if (keys) {
      const publishedAlert = (await repo.getAlert(this.db, alertId)) as AlertRow;
      const cap = this.toCap(publishedAlert);
      const { signature } = signCapPayload(cap, keys);
      await repo.setSignature(this.db, alertId, signature, keys.keyId);
    }

    await this.audit?.record({
      actorId: userId,
      action: 'alert.published',
      resourceType: 'alert',
      resourceId: alertId,
      placeId: alert.place_id,
      metadata: {
        severity: alert.severity, recipients, smsAttempted, smsDelivered,
        whatsappAttempted, whatsappDelivered, emailAttempted, emailDelivered,
        focalPointsNotified, signed: !!keys,
      },
    });

    return (await repo.getAlert(this.db, alertId)) as AlertRow;
  }

  /**
   * Printable HTML notice sheet for physical posting (spec 02 N6 — a
   * community notice board). No auth needed once an alert is published —
   * CAP scope is 'Public' — but returns null for a draft (nothing to post yet).
   */
  async noticeSheetHtml(id: string): Promise<string | null> {
    const alert = await repo.getAlert(this.db, id);
    if (!alert || alert.status !== 'published') return null;
    return formatNoticeSheetHtml({
      alertId: alert.id,
      publishedAt: alert.published_at,
      headline: alert.headline,
      description: alert.description,
      instruction: alert.instruction,
      areaDesc: alert.area_desc,
      severity: alert.severity as CapSeverity,
    });
  }

  /** The public signing key + algorithm, so anyone can verify a signature independently (no auth). */
  getPublicKey(): { keyId: string; publicKeyPem: string; algorithm: 'Ed25519' } | null {
    const keys = getSigningKeys();
    return keys ? { keyId: keys.keyId, publicKeyPem: keys.publicKeyPem, algorithm: 'Ed25519' } : null;
  }

  /**
   * Recomputes verification of a published alert's signature against the
   * current public key. Does NOT trust the stored signature blindly — it
   * re-derives the CAP payload from the alert row and checks the signature
   * over that, so a tampered DB row (or a tampered signature) both fail.
   */
  async verify(id: string): Promise<{
    verified: boolean;
    signature: string | null;
    keyId: string | null;
    signedAt: string | null;
    cap: ReturnType<AlertsService['toCap']>;
  }> {
    const alert = await repo.getAlert(this.db, id);
    if (!alert) throw new Error('Alert not found');
    const cap = this.toCap(alert);
    const keys = getSigningKeys();
    const verified = !!(alert.signature && keys && verifyCapSignature(cap, alert.signature, keys.publicKeyPem));
    return { verified, signature: alert.signature, keyId: alert.signing_key_id, signedAt: alert.signed_at, cap };
  }
}
