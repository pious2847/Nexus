/**
 * Community focal point service (spec 02 N6). Registers the "last-mile
 * human network" — focal persons, radio stations, notice-board locations —
 * that AlertsService.publish() fans out a broadcast-ready script to.
 */
import type { Db } from '../../../shared/db';
import type { AuditRecorder } from '../../../core/audit/audit.service';
import type { GeographyService } from '../../../core/geography/geography.service';
import * as repo from './focal-point.repository';
import type { FocalPointRow, UpdateFocalPointPatch } from './focal-point.repository';

export interface RegisterFocalPointInput {
  placeId: string;
  name: string;
  relayMethod: string;
  stationName?: string | null;
  contactPhone?: string | null;
  contactEmail?: string | null;
  notes?: string | null;
}

export class FocalPointService {
  constructor(
    private readonly db: Db,
    private readonly geography: GeographyService,
    private readonly audit?: AuditRecorder,
  ) {}

  async register(input: RegisterFocalPointInput, registeredBy: string): Promise<FocalPointRow> {
    const point = await repo.insertFocalPoint(this.db, { ...input, registeredBy });
    await this.audit?.record({
      actorId: registeredBy,
      action: 'focal.registered',
      resourceType: 'community_focal_point',
      resourceId: point.id,
      placeId: point.place_id,
      metadata: { relayMethod: point.relay_method },
    });
    return point;
  }

  getFocalPoint(id: string) {
    return repo.getFocalPoint(this.db, id);
  }

  focalPointPlacePath(id: string) {
    return repo.getFocalPointPlacePath(this.db, id);
  }

  listByScope(scopePlaceId: string, filter: { relayMethod?: string; active?: boolean } = {}) {
    return repo.listByScope(this.db, scopePlaceId, filter);
  }

  async update(id: string, patch: UpdateFocalPointPatch, actorId: string): Promise<FocalPointRow> {
    const before = await repo.getFocalPoint(this.db, id);
    if (!before) throw new Error('Community focal point not found');
    const updated = await repo.updateFocalPoint(this.db, id, patch);
    if (!updated) throw new Error('Community focal point not found');
    await this.audit?.record({
      actorId,
      action: 'focal.updated',
      resourceType: 'community_focal_point',
      resourceId: id,
      placeId: before.place_id,
      metadata: { changed: Object.keys(patch) },
    });
    return updated;
  }

  /** Active focal points covering an alert's area — used by AlertsService's dissemination fan-out. */
  findActiveByScope(placePath: string) {
    return repo.findActiveByScope(this.db, placePath);
  }

  /** Resolve a place from coordinates (mirrors every other module's resolvePlace). */
  async resolvePlace(lng?: number, lat?: number): Promise<string | null> {
    if (lng == null || lat == null) return null;
    return (await this.geography.districtForPoint({ lng, lat }))?.id ?? null;
  }
}
