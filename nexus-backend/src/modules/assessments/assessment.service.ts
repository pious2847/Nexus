/**
 * Rapid post-event damage & needs assessment service (spec 02 N15). A
 * structured field assessment (households affected, casualties, damaged
 * infrastructure, urgent needs), geo-tagged, submitted via mobile forms —
 * auto-rolls up into a situation report (a live aggregation across a
 * scope/hazard event, not a separate stored document). Mirrors
 * ShelterService's shape (optional-audit pattern, resolvePlace via reverse
 * geocode).
 */
import type { Db } from '../../shared/db';
import type { AuditRecorder } from '../../core/audit/audit.service';
import type { GeographyService } from '../../core/geography/geography.service';
import * as repo from './assessment.repository';
import type { DamageAssessmentRow, ListAssessmentFilter, SituationReport } from './assessment.repository';

export interface SubmitAssessmentInput {
  placeId: string;
  hazardEventId?: string | null;
  lng?: number | null;
  lat?: number | null;
  householdsAffected?: number;
  personsAffected?: number;
  casualties?: number;
  injuries?: number;
  infrastructureDamage?: string | null;
  urgentNeeds?: string[];
  media?: unknown;
  notes?: string | null;
}

export class AssessmentService {
  constructor(
    private readonly db: Db,
    private readonly geography: GeographyService,
    private readonly audit?: AuditRecorder,
  ) {}

  /** Submit a new rapid damage & needs assessment. Audits every submission. */
  async submit(input: SubmitAssessmentInput, assessedBy: string): Promise<DamageAssessmentRow> {
    const assessment = await repo.insertAssessment(this.db, { ...input, assessedBy });
    await this.audit?.record({
      actorId: assessedBy,
      action: 'assessment.submitted',
      resourceType: 'damage_assessment',
      resourceId: assessment.id,
      placeId: assessment.place_id,
      metadata: {
        hazardEventId: assessment.hazard_event_id,
        householdsAffected: assessment.households_affected,
        personsAffected: assessment.persons_affected,
        casualties: assessment.casualties,
        injuries: assessment.injuries,
        urgentNeeds: assessment.urgent_needs,
      },
    });
    return assessment;
  }

  getAssessment(id: string): Promise<DamageAssessmentRow | null> {
    return repo.getAssessment(this.db, id);
  }

  assessmentPlacePath(id: string): Promise<string | null> {
    return repo.assessmentPlacePath(this.db, id);
  }

  /** List a district/region's assessments, optionally filtered to a hazard event. */
  listByScope(scopePlaceId: string, filters: ListAssessmentFilter = {}): Promise<DamageAssessmentRow[]> {
    return repo.listAssessmentsByScope(this.db, scopePlaceId, filters);
  }

  /** The auto-rolled-up situation report for a scope, optionally scoped further to one hazard event. */
  situationReport(scopePlaceId: string, hazardEventId?: string): Promise<SituationReport> {
    return repo.situationReport(this.db, scopePlaceId, hazardEventId);
  }

  /** Resolve a place from coordinates (mirrors ShelterService.resolvePlace / HealthFacilityService.resolvePlace). */
  async resolvePlace(lng?: number, lat?: number): Promise<string | null> {
    if (lng == null || lat == null) return null;
    return (await this.geography.districtForPoint({ lng, lat }))?.id ?? null;
  }
}
