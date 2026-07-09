/**
 * Rumor intake & review service (Module N — N11 Rumor & misinformation
 * control). Citizens/field workers report a rumor; officers review it and
 * mark it confirmed-false / confirmed-true / clarified. A confirmed rumor is
 * the typical trigger for an official MythFactService.publish() clarification
 * (linked via `rumor_report_id`), but that wiring is a caller decision, not
 * done automatically here.
 */
import type { Db } from '../../shared/db';
import type { AuditRecorder } from '../../core/audit/audit.service';
import type { GeographyService } from '../../core/geography/geography.service';
import * as repo from './rumor.repository';
import type { RumorReportRow, ListRumorFilter } from './rumor.repository';

export interface ReportRumorInput {
  placeId?: string | null;
  hazardEventId?: string | null;
  description: string;
  source?: string | null;
  reporterPhone?: string | null;
}

export interface ReviewRumorPatch {
  status: string;
  resolutionNotes?: string | null;
}

export class RumorService {
  constructor(
    private readonly db: Db,
    private readonly geography: GeographyService,
    private readonly audit?: AuditRecorder,
  ) {}

  /** Report a rumor. `placeId` is optional — an unscoped report is still accepted (requires national-level review). */
  async report(input: ReportRumorInput, reporterId: string): Promise<RumorReportRow> {
    const rumor = await repo.insertRumorReport(this.db, { ...input, reporterId });
    await this.audit?.record({
      actorId: reporterId,
      action: 'rumor.reported',
      resourceType: 'rumor_report',
      resourceId: rumor.id,
      placeId: rumor.place_id,
      metadata: { source: rumor.source, hazardEventId: rumor.hazard_event_id },
    });
    return rumor;
  }

  getRumor(id: string) {
    return repo.getRumorReport(this.db, id);
  }

  rumorPlacePath(id: string) {
    return repo.rumorPlacePath(this.db, id);
  }

  /** List a district/region's reported rumors. */
  listByScope(scopePlaceId: string, filters: ListRumorFilter = {}): Promise<RumorReportRow[]> {
    return repo.listRumorsByScope(this.db, scopePlaceId, filters);
  }

  /** Officer review — sets status, reviewedBy/reviewedAt, and an optional resolution note. */
  async review(id: string, patch: ReviewRumorPatch, actorId: string): Promise<RumorReportRow> {
    const before = await repo.getRumorReport(this.db, id);
    if (!before) throw new Error('Rumor report not found');
    const updated = await repo.updateRumorReport(this.db, id, {
      status: patch.status,
      resolutionNotes: patch.resolutionNotes,
      reviewedBy: actorId,
      reviewedAt: new Date(),
    });
    if (!updated) throw new Error('Rumor report not found');
    await this.audit?.record({
      actorId,
      action: 'rumor.reviewed',
      resourceType: 'rumor_report',
      resourceId: id,
      placeId: before.place_id,
      metadata: { status: patch.status, resolutionNotes: patch.resolutionNotes },
    });
    return updated;
  }

  /** Resolve a place from coordinates (mirrors shelter.service's resolvePlace) — used by routes to turn optional lng/lat into a placeId. */
  async resolvePlace(lng?: number, lat?: number): Promise<string | null> {
    if (lng == null || lat == null) return null;
    return (await this.geography.districtForPoint({ lng, lat }))?.id ?? null;
  }
}
