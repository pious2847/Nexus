/**
 * Vulnerable-persons registry service (spec 02 N4). Sensitive PII: every
 * mutation is audited, and every list is scoped to a geography subtree — there
 * is deliberately no "list everyone nationally" method here.
 */
import type { Db } from '../../shared/db';
import type { AuditRecorder } from '../../core/audit/audit.service';
import type { GeographyService } from '../../core/geography/geography.service';
import * as repo from './vulnerable.repository';
import type { VulnerablePersonRow } from './vulnerable.repository';
import { sortByEvacuationPriority, type MobilityLevel, type VulnerableCategory } from './vulnerable.priority';

export interface RegisterInput {
  placeId: string;
  fullName: string;
  category: string;
  mobilityLevel: string;
  householdContactPhone?: string | null;
  householdSize?: number | null;
  specialNeeds?: string | null;
  consentStatus: string;
  consentBy?: string | null;
  lng?: number | null;
  lat?: number | null;
}

export class VulnerablePersonsService {
  constructor(
    private readonly db: Db,
    private readonly geography: GeographyService,
    private readonly audit?: AuditRecorder,
  ) {}

  async register(input: RegisterInput, registeredBy: string): Promise<VulnerablePersonRow> {
    const person = await repo.insertVulnerablePerson(this.db, { ...input, registeredBy });
    await this.audit?.record({
      actorId: registeredBy,
      action: 'vulnerable.registered',
      resourceType: 'vulnerable_person',
      resourceId: person.id,
      placeId: person.place_id,
      metadata: { category: person.category, consentStatus: person.consent_status },
    });
    return person;
  }

  getPerson(id: string) {
    return repo.getVulnerablePerson(this.db, id);
  }

  personPlacePath(id: string) {
    return repo.getPersonPlacePath(this.db, id);
  }

  /** List a district/region's registry, optionally sorted by evacuation priority. */
  async listByScope(
    scopePlaceId: string,
    filter: { status?: string; category?: string; prioritySort?: boolean } = {},
  ): Promise<VulnerablePersonRow[]> {
    const rows = await repo.listByScope(this.db, scopePlaceId, filter);
    if (!filter.prioritySort) return rows;
    return sortByEvacuationPriority(rows, (r) => ({
      category: r.category as VulnerableCategory,
      mobility: r.mobility_level as MobilityLevel,
      householdSize: r.household_size,
    }));
  }

  async updateStatus(id: string, status: string, actorId: string): Promise<VulnerablePersonRow> {
    const before = await repo.getVulnerablePerson(this.db, id);
    if (!before) throw new Error('Vulnerable-person record not found');
    await repo.updateStatus(this.db, id, status);
    await this.audit?.record({
      actorId,
      action: 'vulnerable.status_changed',
      resourceType: 'vulnerable_person',
      resourceId: id,
      placeId: before.place_id,
      metadata: { from: before.status, to: status },
    });
    return (await repo.getVulnerablePerson(this.db, id)) as VulnerablePersonRow;
  }

  async updateConsent(id: string, consentStatus: string, consentBy: string | null, actorId: string): Promise<VulnerablePersonRow> {
    const before = await repo.getVulnerablePerson(this.db, id);
    if (!before) throw new Error('Vulnerable-person record not found');
    await repo.updateConsent(this.db, id, consentStatus, consentBy);
    await this.audit?.record({
      actorId,
      action: 'vulnerable.consent_changed',
      resourceType: 'vulnerable_person',
      resourceId: id,
      placeId: before.place_id,
      metadata: { from: before.consent_status, to: consentStatus },
    });
    return (await repo.getVulnerablePerson(this.db, id)) as VulnerablePersonRow;
  }

  /** Resolve a place from coordinates (mirrors reports.service — reuses the geography service). */
  async resolvePlace(lng?: number, lat?: number): Promise<string | null> {
    if (lng == null || lat == null) return null;
    return (await this.geography.districtForPoint({ lng, lat }))?.id ?? null;
  }
}
