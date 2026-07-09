/**
 * Shelter / safe-zone registry service (Module M — Emergency Response &
 * Coordination). Geo-scoped like the health-facility registry, plus
 * occupancy tracking with an automatic open/full status transition and a
 * public "nearest open shelter" lookup for citizens during an active event.
 */
import type { Db } from '../../../shared/db';
import type { AuditRecorder } from '../../../core/audit/audit.service';
import type { GeographyService } from '../../../core/geography/geography.service';
import * as repo from './shelter.repository';
import type { ShelterRow, UpdateShelterPatch, ListShelterFilter } from './shelter.repository';

export interface RegisterShelterInput {
  placeId: string;
  name: string;
  capacity?: number | null;
  facilities?: string[];
  contactPhone?: string | null;
  managedBy?: string | null;
  notes?: string | null;
  lng?: number | null;
  lat?: number | null;
}

export class ShelterService {
  constructor(
    private readonly db: Db,
    private readonly geography: GeographyService,
    private readonly audit?: AuditRecorder,
  ) {}

  /** Register a new shelter. Defaults managed_by to the registering actor if not given explicitly. */
  async register(input: RegisterShelterInput, registeredBy: string): Promise<ShelterRow> {
    const shelter = await repo.insertShelter(this.db, { ...input, managedBy: input.managedBy ?? registeredBy });
    await this.audit?.record({
      actorId: registeredBy,
      action: 'shelter.registered',
      resourceType: 'shelter',
      resourceId: shelter.id,
      placeId: shelter.place_id,
      metadata: { capacity: shelter.capacity, facilities: shelter.facilities },
    });
    return shelter;
  }

  getShelter(id: string) {
    return repo.getShelter(this.db, id);
  }

  shelterPlacePath(id: string) {
    return repo.getShelterPlacePath(this.db, id);
  }

  /** List a district/region's shelter registry. */
  listByScope(scopePlaceId: string, filter: ListShelterFilter = {}): Promise<ShelterRow[]> {
    return repo.listByScope(this.db, scopePlaceId, filter);
  }

  async update(id: string, patch: UpdateShelterPatch, actorId: string): Promise<ShelterRow> {
    const before = await repo.getShelter(this.db, id);
    if (!before) throw new Error('Shelter not found');
    const updated = await repo.updateShelter(this.db, id, patch);
    if (!updated) throw new Error('Shelter not found');
    await this.audit?.record({
      actorId,
      action: 'shelter.updated',
      resourceType: 'shelter',
      resourceId: id,
      placeId: before.place_id,
      metadata: { changed: Object.keys(patch), patch },
    });
    return updated;
  }

  /**
   * Adjust occupancy by `delta` (positive = check-in, negative = check-out),
   * clamped at 0 by the repository. If the shelter has a capacity set and
   * isn't 'closed', auto-transitions status to 'full' once occupancy
   * reaches/exceeds capacity, and back to 'open' once it drops back below —
   * 'closed' shelters are never auto-reopened.
   */
  async adjustOccupancy(id: string, delta: number, actorId: string): Promise<ShelterRow> {
    const updated = await repo.updateOccupancy(this.db, id, delta);
    if (!updated) throw new Error('Shelter not found');

    let result = updated;
    if (updated.capacity != null && updated.status !== 'closed') {
      const atCapacity = updated.current_occupancy >= updated.capacity;
      if (atCapacity && updated.status !== 'full') {
        result = (await repo.updateShelter(this.db, id, { status: 'full' })) ?? updated;
      } else if (!atCapacity && updated.status === 'full') {
        result = (await repo.updateShelter(this.db, id, { status: 'open' })) ?? updated;
      }
    }

    await this.audit?.record({
      actorId,
      action: 'shelter.occupancy_changed',
      resourceType: 'shelter',
      resourceId: id,
      placeId: updated.place_id,
      metadata: { delta, currentOccupancy: result.current_occupancy, status: result.status },
    });
    return result;
  }

  /** Nearest open shelters to a point — public, citizen-facing (see routes). */
  findNearestOpen(point: { lng: number; lat: number }, limit = 5) {
    return repo.findNearestOpen(this.db, point, limit);
  }

  /** Resolve a place from coordinates (mirrors health-facility.service's resolvePlace). */
  async resolvePlace(lng?: number, lat?: number): Promise<string | null> {
    if (lng == null || lat == null) return null;
    return (await this.geography.districtForPoint({ lng, lat }))?.id ?? null;
  }
}
