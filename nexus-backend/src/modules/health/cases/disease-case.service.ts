/**
 * Disease case reporting service (Module D — Health & Disease Surveillance).
 * Epi-aggregate only: case reports carry no patient name/identifier (just
 * age_group/sex), so the audit metadata mirrors that minimization — only
 * disease_code + case_status are recorded, never age_group/sex/notes.
 */
import type { Db } from '../../../shared/db';
import type { AuditRecorder } from '../../../core/audit/audit.service';
import type { GeographyService } from '../../../core/geography/geography.service';
import * as repo from './disease-case.repository';
import type { DiseaseCaseRow } from './disease-case.repository';

export interface ReportCaseInput {
  diseaseCode: string;
  placeId: string;
  facilityId?: string | null;
  caseStatus: string;
  source: string;
  ageGroup?: string | null;
  sex?: string | null;
  onsetDate?: string | null;
  notes?: string | null;
}

export class DiseaseCaseService {
  constructor(
    private readonly db: Db,
    private readonly geography: GeographyService,
    private readonly audit?: AuditRecorder,
  ) {}

  async report(input: ReportCaseInput, reportedBy?: string | null): Promise<DiseaseCaseRow> {
    const diseaseCase = await repo.insertCase(this.db, { ...input, reportedBy: reportedBy ?? null });
    await this.audit?.record({
      actorId: reportedBy ?? null,
      action: 'health.case.reported',
      resourceType: 'disease_case',
      resourceId: diseaseCase.id,
      placeId: diseaseCase.place_id,
      metadata: { disease_code: diseaseCase.disease_code, case_status: diseaseCase.case_status },
    });
    return diseaseCase;
  }

  getCase(id: string) {
    return repo.getCase(this.db, id);
  }

  casePlacePath(id: string) {
    return repo.getCasePlacePath(this.db, id);
  }

  listByScope(scopePlaceId: string, filter: Parameters<typeof repo.listByScope>[2] = {}) {
    return repo.listByScope(this.db, scopePlaceId, filter);
  }

  /** Resolve a place from coordinates (mirrors vulnerable.service.ts / reports.service.ts). */
  async resolvePlace(lng?: number, lat?: number): Promise<string | null> {
    if (lng == null || lat == null) return null;
    return (await this.geography.districtForPoint({ lng, lat }))?.id ?? null;
  }
}
