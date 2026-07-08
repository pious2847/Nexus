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

    // Fan out WhatsApp to subscribers who opted in. NOTE: not live-sendable until
    // WHATSAPP_PHONE_ID is configured — the adapter logs instead of failing until then
    // (see integrations/whatsapp.ts), so attempted/delivered legitimately diverge.
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

    await repo.setPublished(this.db, alertId, userId, {
      recipients, smsAttempted, smsDelivered, whatsappAttempted, whatsappDelivered, emailAttempted, emailDelivered,
    });
    await this.audit?.record({
      actorId: userId,
      action: 'alert.published',
      resourceType: 'alert',
      resourceId: alertId,
      placeId: alert.place_id,
      metadata: {
        severity: alert.severity, recipients, smsAttempted, smsDelivered,
        whatsappAttempted, whatsappDelivered, emailAttempted, emailDelivered,
      },
    });

    return (await repo.getAlert(this.db, alertId)) as AlertRow;
  }
}
