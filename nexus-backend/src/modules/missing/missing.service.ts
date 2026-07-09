/**
 * Missing persons & family reunification service (spec 02 N3). Sensitive
 * PII, same posture as VulnerablePersonsService: every mutation is audited,
 * every list is scoped to a geography subtree. Matching against safety
 * check-ins and the vulnerable-persons registry is candidate discovery only
 * (pg_trgm fuzzy name match within the record's place subtree) — a human
 * (missing.manage) confirms a match via updateStatus, nothing here writes a
 * match automatically.
 */
import type { Db } from '../../shared/db';
import type { AuditRecorder } from '../../core/audit/audit.service';
import type { GeographyService } from '../../core/geography/geography.service';
import * as repo from './missing.repository';
import type {
  MissingPersonRow,
  ListMissingFilter,
  CandidateCheckinRow,
  CandidateVulnerablePersonRow,
} from './missing.repository';
import { isValidMissingStatus, isResolvedMissingStatus, type MissingPersonStatus } from './missing.status';

export interface ReportMissingPersonInput {
  placeId: string;
  fullName: string;
  ageEstimate?: string | null;
  sex?: string | null;
  distinguishingFeatures?: string | null;
  photoUrl?: string | null;
  lastSeenLng?: number | null;
  lastSeenLat?: number | null;
  lastSeenAt?: Date | string | null;
  reporterPhone: string;
  relationshipToMissing?: string | null;
  notes?: string | null;
}

export interface UpdateMissingPersonInput {
  status?: string;
  matchedCheckinId?: string | null;
  matchedVulnerablePersonId?: string | null;
  notes?: string | null;
}

export type MatchCandidate =
  | { kind: 'safety_checkin'; score: number; record: CandidateCheckinRow }
  | { kind: 'vulnerable_person'; score: number; record: CandidateVulnerablePersonRow };

export interface MatchResult {
  missingPerson: MissingPersonRow;
  candidates: MatchCandidate[];
}

export class MissingPersonsService {
  constructor(
    private readonly db: Db,
    private readonly geography: GeographyService,
    private readonly audit?: AuditRecorder,
  ) {}

  /** Report a missing person. `reporterId` is the authenticated actor (also stored as reporter_id). */
  async report(input: ReportMissingPersonInput, reporterId: string): Promise<MissingPersonRow> {
    const record = await repo.insertMissingPerson(this.db, { ...input, reporterId });
    await this.audit?.record({
      actorId: reporterId,
      action: 'missing.reported',
      resourceType: 'missing_person',
      resourceId: record.id,
      placeId: record.place_id,
      metadata: { fullName: record.full_name },
    });
    return record;
  }

  getMissingPerson(id: string) {
    return repo.getMissingPerson(this.db, id);
  }

  missingPersonPlacePath(id: string) {
    return repo.missingPersonPlacePath(this.db, id);
  }

  /** List a district/region's missing-persons board. */
  listByScope(scopePlaceId: string, filter: ListMissingFilter = {}): Promise<MissingPersonRow[]> {
    return repo.listMissingByScope(this.db, scopePlaceId, filter);
  }

  /**
   * Candidate matches for a missing-person record: fuzzy name matches
   * (pg_trgm similarity > 0.3) against safety check-ins and the
   * vulnerable-persons registry, scoped to the record's own place subtree,
   * combined and ranked by score (highest first).
   */
  async findMatches(id: string): Promise<MatchResult> {
    const missingPerson = await repo.getMissingPerson(this.db, id);
    if (!missingPerson) throw new Error('Missing-person record not found');

    const [checkins, vulnerablePersons] = await Promise.all([
      repo.findCandidateCheckins(this.db, missingPerson.place_id, missingPerson.full_name),
      repo.findCandidateVulnerablePersons(this.db, missingPerson.place_id, missingPerson.full_name),
    ]);

    const candidates: MatchCandidate[] = [
      ...checkins.map((record): MatchCandidate => ({ kind: 'safety_checkin', score: record.score, record })),
      ...vulnerablePersons.map((record): MatchCandidate => ({ kind: 'vulnerable_person', score: record.score, record })),
    ].sort((a, b) => b.score - a.score);

    return { missingPerson, candidates };
  }

  /**
   * Update status and/or recorded match/notes. Validates `status` is one of
   * the DB enum members (no full transition state machine — any officer can
   * move a record between any of the four states, e.g. reopening a
   * wrongly-closed record). Moving into a resolved status
   * (found|reunified|closed) stamps resolved_by/resolved_at with the acting
   * officer/now.
   */
  async updateStatus(id: string, patch: UpdateMissingPersonInput, actorId: string): Promise<MissingPersonRow> {
    const before = await repo.getMissingPerson(this.db, id);
    if (!before) throw new Error('Missing-person record not found');

    if (patch.status !== undefined && !isValidMissingStatus(patch.status)) {
      throw new Error(`Invalid missing-person status: ${patch.status}`);
    }
    const resolving = patch.status !== undefined && isResolvedMissingStatus(patch.status as MissingPersonStatus);

    const updated = await repo.updateMissingPerson(this.db, id, {
      status: patch.status,
      matchedCheckinId: patch.matchedCheckinId,
      matchedVulnerablePersonId: patch.matchedVulnerablePersonId,
      notes: patch.notes,
      resolvedBy: resolving ? actorId : undefined,
      resolvedAt: resolving ? new Date() : undefined,
    });
    if (!updated) throw new Error('Missing-person record not found');

    await this.audit?.record({
      actorId,
      action: 'missing.status_changed',
      resourceType: 'missing_person',
      resourceId: id,
      placeId: before.place_id,
      metadata: { from: before.status, to: updated.status, patch },
    });
    return updated;
  }

  /** Resolve a place from coordinates (mirrors shelter.service's resolvePlace). */
  async resolvePlace(lng?: number, lat?: number): Promise<string | null> {
    if (lng == null || lat == null) return null;
    return (await this.geography.districtForPoint({ lng, lat }))?.id ?? null;
  }
}
