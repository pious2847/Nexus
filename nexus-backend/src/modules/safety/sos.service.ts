/**
 * SOS / panic-button service (spec 02 N2). Module M (formal dispatch
 * tasking) doesn't exist yet — this achieves the "minutes matter" goal via
 * immediate SMS + in-app notification of every responder whose role/geo
 * scope covers the affected place, rather than a dispatch board.
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

    await this.audit?.record({
      actorId: reportedBy ?? null,
      action: 'sos.raised',
      resourceType: 'sos_alert',
      resourceId: alert.id,
      placeId: alert.place_id,
      metadata: { dangerType: alert.danger_type, locationPrecision: alert.location_precision, respondersNotified: notified },
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
