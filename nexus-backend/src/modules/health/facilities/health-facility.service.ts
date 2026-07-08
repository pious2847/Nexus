/**
 * Health-facility registry service (Module D — Health & Disease Surveillance).
 * Public infrastructure data: clinics, hospitals, CHPS compounds, health
 * centers. Every list is scoped to a geography subtree (same pattern as the
 * vulnerable-persons registry / hazard map); every mutation is audited.
 */
import type { Db } from '../../../shared/db';
import type { AuditRecorder } from '../../../core/audit/audit.service';
import type { GeographyService } from '../../../core/geography/geography.service';
import * as repo from './health-facility.repository';
import type { HealthFacilityRow, UpdateFacilityPatch } from './health-facility.repository';

export interface RegisterFacilityInput {
  placeId: string;
  name: string;
  facilityType: string;
  ownership?: string | null;
  contactPhone?: string | null;
  bedCount?: number | null;
  lng?: number | null;
  lat?: number | null;
}

export class HealthFacilityService {
  constructor(
    private readonly db: Db,
    private readonly geography: GeographyService,
    private readonly audit?: AuditRecorder,
  ) {}

  async register(input: RegisterFacilityInput, registeredBy: string): Promise<HealthFacilityRow> {
    const facility = await repo.insertFacility(this.db, { ...input, createdBy: registeredBy });
    await this.audit?.record({
      actorId: registeredBy,
      action: 'health.facility.registered',
      resourceType: 'health_facility',
      resourceId: facility.id,
      placeId: facility.place_id,
      metadata: { facilityType: facility.facility_type, ownership: facility.ownership },
    });
    return facility;
  }

  getFacility(id: string) {
    return repo.getFacility(this.db, id);
  }

  facilityPlacePath(id: string) {
    return repo.getFacilityPlacePath(this.db, id);
  }

  /** List a district/region's facility registry. */
  listByScope(scopePlaceId: string, filter: { facilityType?: string; status?: string } = {}): Promise<HealthFacilityRow[]> {
    return repo.listByScope(this.db, scopePlaceId, filter);
  }

  async update(id: string, patch: UpdateFacilityPatch, actorId: string): Promise<HealthFacilityRow> {
    const before = await repo.getFacility(this.db, id);
    if (!before) throw new Error('Health facility record not found');
    const updated = await repo.updateFacility(this.db, id, patch);
    if (!updated) throw new Error('Health facility record not found');
    await this.audit?.record({
      actorId,
      action: 'health.facility.updated',
      resourceType: 'health_facility',
      resourceId: id,
      placeId: before.place_id,
      metadata: { changed: Object.keys(patch), patch },
    });
    return updated;
  }

  /** Resolve a place from coordinates (mirrors vulnerable.service's resolvePlace). */
  async resolvePlace(lng?: number, lat?: number): Promise<string | null> {
    if (lng == null || lat == null) return null;
    return (await this.geography.districtForPoint({ lng, lat }))?.id ?? null;
  }
}
