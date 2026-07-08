/**
 * "I'm Safe" check-in service (spec 02 N1). Deliberately lightweight: no
 * verification/trust workflow like incident reports — a false "I'm safe" is
 * far less dangerous than one being missed, so nothing here gatekeeps a
 * check-in from being recorded.
 */
import type { Db } from '../../shared/db';
import type { AuditRecorder } from '../../core/audit/audit.service';
import type { GeographyService } from '../../core/geography/geography.service';
import * as repo from './checkin.repository';
import type { CheckinRow, CheckinSummary } from './checkin.repository';

export interface CheckInInput {
  placeId: string;
  status: string;
  subjectName?: string | null;
  reporterPhone?: string | null;
  source: string;
  notes?: string | null;
}

export class SafetyCheckinService {
  constructor(
    private readonly db: Db,
    private readonly geography: GeographyService,
    private readonly audit?: AuditRecorder,
  ) {}

  async checkIn(input: CheckInInput, reportedBy?: string | null): Promise<CheckinRow> {
    const hazardEventId = await repo.findActiveEventForPlace(this.db, input.placeId);
    const checkin = await repo.insertCheckin(this.db, { ...input, hazardEventId, reportedBy: reportedBy ?? null });
    await this.audit?.record({
      actorId: reportedBy ?? null,
      action: 'safety.checkin.recorded',
      resourceType: 'safety_checkin',
      resourceId: checkin.id,
      placeId: checkin.place_id,
      metadata: { status: checkin.status, hazardEventId, onBehalfOf: !!input.subjectName },
    });
    return checkin;
  }

  listByEvent(hazardEventId: string): Promise<CheckinRow[]> {
    return repo.listByEvent(this.db, hazardEventId);
  }

  summaryByEvent(hazardEventId: string): Promise<CheckinSummary[]> {
    return repo.summaryByEvent(this.db, hazardEventId);
  }

  listByScope(scopePlaceId: string, filter: { status?: string } = {}): Promise<CheckinRow[]> {
    return repo.listByScope(this.db, scopePlaceId, filter);
  }

  /** Resolve a place from coordinates (mirrors every other module's resolvePlace). */
  async resolvePlace(lng?: number, lat?: number): Promise<string | null> {
    if (lng == null || lat == null) return null;
    return (await this.geography.districtForPoint({ lng, lat }))?.id ?? null;
  }
}
