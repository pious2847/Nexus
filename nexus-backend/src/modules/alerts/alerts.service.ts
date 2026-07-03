/**
 * Alerts service — draft a CAP alert from a hazard event, then publish it under
 * tiered authority (spec §11) and fan out in-app notifications to subscribers of
 * the affected area. Multi-channel delivery (SMS/push/WhatsApp/voice) layers on
 * top of the notification step later.
 */
import type { CapSeverity } from '@nexus/shared';
import type { Db } from '../../shared/db';
import type { AuditRecorder } from '../../core/audit/audit.service';
import type { RbacService } from '../../core/rbac/rbac.service';
import type { NotificationsService } from '../../core/notifications/notifications.service';
import * as repo from './alerts.repository';
import type { AlertRow } from './alerts.repository';
import { requiredPublishPermission, toCapJson } from './alerts.cap';

export class PublishForbiddenError extends Error {}

export class AlertsService {
  constructor(
    private readonly db: Db,
    private readonly rbac: RbacService,
    private readonly notifications: NotificationsService,
    private readonly audit?: AuditRecorder,
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

    await repo.setPublished(this.db, alertId, userId, recipients);
    await this.audit?.record({
      actorId: userId,
      action: 'alert.published',
      resourceType: 'alert',
      resourceId: alertId,
      placeId: alert.place_id,
      metadata: { severity: alert.severity, recipients },
    });

    return (await repo.getAlert(this.db, alertId)) as AlertRow;
  }
}
