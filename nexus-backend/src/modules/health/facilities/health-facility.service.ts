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
import type {
  HealthFacilityRow,
  UpdateFacilityPatch,
  CapacityStatusRow,
  InsertCapacityStatusInput,
  NearestWithCapacityRow,
} from './health-facility.repository';

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

  /**
   * File a new live capacity report (beds/blood/ambulances/status) for a
   * facility (Module N16 — mass-casualty coordination). Always inserts a new
   * row — the time series is the audit trail for capacity, this action log
   * entry is the RBAC/audit trail for who filed it.
   */
  async reportCapacity(facilityId: string, input: InsertCapacityStatusInput, reportedBy: string): Promise<CapacityStatusRow> {
    const report = await repo.insertCapacityStatus(this.db, facilityId, { ...input, reportedBy });
    await this.audit?.record({
      actorId: reportedBy,
      action: 'health.facility.capacity_reported',
      resourceType: 'health_facility',
      resourceId: facilityId,
      metadata: {
        status: report.status,
        bedsAvailable: report.beds_available,
        bloodUnitsAvailable: report.blood_units_available,
        ambulancesAvailable: report.ambulances_available,
      },
    });
    return report;
  }

  /** Latest capacity report for a facility, or null if none has ever been filed (a valid state). */
  getCapacity(facilityId: string): Promise<CapacityStatusRow | null> {
    return repo.getLatestCapacityStatus(this.db, facilityId);
  }

  /** Nearest facility with a capacity report meeting the given filters. */
  findNearestWithCapacity(
    point: { lng: number; lat: number },
    opts: { minBeds?: number; status?: string } = {},
    limit = 5,
  ): Promise<NearestWithCapacityRow[]> {
    return repo.findNearestWithCapacity(this.db, point, opts, limit);
  }
}
