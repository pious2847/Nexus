/**
 * SOS / panic-button service (spec 02 N2). Immediately SMS + in-app notifies
 * every responder whose role/geo scope covers the affected place (the
 * "minutes matter" goal), AND — now that Module M exists — auto-creates a
 * critical-priority dispatch task (`source_type: 'sos'`), the formal
 * dispatch-board link the spec originally described.
 */
import type { Db } from '../../shared/db';
import type { AuditRecorder } from '../../core/audit/audit.service';
import type { GeographyService } from '../../core/geography/geography.service';
import type { NotificationsService } from '../../core/notifications/notifications.service';
import { sendSms as defaultSendSms, type SmsResult } from '../../integrations/arkesel';
import { roleHasPermission } from '../../core/rbac/rbac';
import type { Role } from '@nexus/shared';
import * as repo from './sos.repository';
import type { SosAlertRow } from './sos.repository';
import type { DispatchService } from '../response/dispatch/dispatch.service';

type SmsSender = (to: string, message: string) => Promise<SmsResult>;

export interface RaiseSosInput {
  lng: number;
  lat: number;
  locationPrecision: 'gps' | 'district_centroid';
  dangerType?: string | null;
  notes?: string | null;
  reporterPhone?: string | null;
}

export class SosService {
  constructor(
    private readonly db: Db,
    private readonly geography: GeographyService,
    private readonly notifications: NotificationsService,
    private readonly audit?: AuditRecorder,
    private readonly sendSms: SmsSender = defaultSendSms,
    // Optional (not defaulted) — needs a DispatchService this class doesn't otherwise
    // receive. If omitted, raise() just skips auto-creating a dispatch task (same
    // graceful-degrade pattern as AlertsService's optional `focalPoints`).
    private readonly dispatch?: DispatchService,
  ) {}

  async raise(input: RaiseSosInput, reportedBy?: string | null): Promise<SosAlertRow> {
    const place = await this.geography.districtForPoint({ lng: input.lng, lat: input.lat });
    const alert = await repo.insertSos(this.db, {
      placeId: place?.id ?? null,
      lng: input.lng,
      lat: input.lat,
      locationPrecision: input.locationPrecision,
      dangerType: input.dangerType ?? null,
      notes: input.notes ?? null,
      reporterPhone: input.reporterPhone ?? null,
      reportedBy: reportedBy ?? null,
    });

    const notified = await this.notifyResponders(alert, place?.path ?? null, place?.name ?? null);
    await repo.setNotifiedCount(this.db, alert.id, notified);

    // Auto-create a dispatch task so the SOS shows up on the response board, not just
    // as notifications — closing the spec's "auto-creates dispatch task" link (N2).
    if (this.dispatch) {
      await this.dispatch.createTask(
        {
          placeId: alert.place_id,
          lng: alert.lng,
          lat: alert.lat,
          taskType: 'rescue',
          description: alert.notes ?? `SOS${alert.danger_type ? ` — ${alert.danger_type}` : ''}`,
          priority: 'critical',
          sourceType: 'sos',
          sourceId: alert.id,
        },
        reportedBy ?? null,
      );
    }

    await this.audit?.record({
      actorId: reportedBy ?? null,
      action: 'sos.raised',
      resourceType: 'sos_alert',
      resourceId: alert.id,
      placeId: alert.place_id,
      metadata: { dangerType: alert.danger_type, locationPrecision: alert.location_precision, respondersNotified: notified, dispatchLinked: !!this.dispatch },
    });

    return (await repo.getSos(this.db, alert.id)) as SosAlertRow;
  }

  /** Immediately SMS + in-app notify every responder (role has sos.manage) whose scope covers the place. */
  private async notifyResponders(alert: SosAlertRow, placePath: string | null, placeName: string | null): Promise<number> {
    if (!placePath) return 0;
    const candidates = await repo.findResponderCandidates(this.db, placePath);
    const responders = candidates.filter((c) => roleHasPermission(c.role as Role, 'sos.manage'));

    const where = placeName ?? `${alert.lat.toFixed(5)}, ${alert.lng.toFixed(5)}`;
    const mapsLink = `https://maps.google.com/?q=${alert.lat},${alert.lng}`;
    const message = `🆘 NEXUS SOS near ${where}${alert.danger_type ? ` (${alert.danger_type})` : ''}. Location: ${mapsLink}`;

    let notified = 0;
    for (const r of responders) {
      await this.notifications.notify({
        userId: r.userId,
        type: 'sos',
        title: `🆘 SOS near ${where}`,
        body: alert.notes ?? undefined,
        data: { sosId: alert.id, lat: alert.lat, lng: alert.lng, dangerType: alert.danger_type },
      });
      if (r.phone) {
        const result = await this.sendSms(r.phone, message);
        if (result.sent) notified++;
      }
    }
    return notified;
  }

  getSos(id: string) {
    return repo.getSos(this.db, id);
  }

  sosPlacePath(id: string) {
    return repo.getSosPlacePath(this.db, id);
  }

  listActiveByScope(scopePlaceId: string) {
    return repo.listActiveByScope(this.db, scopePlaceId);
  }

  async acknowledge(id: string, actorId: string): Promise<SosAlertRow> {
    await repo.acknowledge(this.db, id, actorId);
    const alert = await repo.getSos(this.db, id);
    if (!alert) throw new Error('SOS alert not found');
    await this.audit?.record({ actorId, action: 'sos.acknowledged', resourceType: 'sos_alert', resourceId: id, placeId: alert.place_id, metadata: {} });
    return alert;
  }

  async resolve(id: string, actorId: string, status: 'resolved' | 'false_alarm'): Promise<SosAlertRow> {
    await repo.resolve(this.db, id, actorId, status);
    const alert = await repo.getSos(this.db, id);
    if (!alert) throw new Error('SOS alert not found');
    await this.audit?.record({ actorId, action: 'sos.resolved', resourceType: 'sos_alert', resourceId: id, placeId: alert.place_id, metadata: { status } });
    return alert;
  }

  /** Resolve a place's centroid — used by the SMS channel (no live GPS over SMS). */
  async centroidForPlace(placeId: string): Promise<{ lng: number; lat: number } | null> {
    return repo.getPlaceCentroid(this.db, placeId);
  }
}
