/**
 * N14 — Common Operating Picture + Incident Command. `getCop()` is a
 * read-side aggregation over already-existing event-linked tables (reports,
 * dispatch, check-ins, SOS, shelters, relief, rumors) plus the damage-
 * assessment situation report (reused directly from Module N15's
 * AssessmentService) and the ICS role roster for this event.
 */
import type { Db } from '../../shared/db';
import type { AuditRecorder } from '../../core/audit/audit.service';
import * as repo from './command.repository';
import { situationReport, type SituationReport } from '../assessments/assessment.repository';

export interface CopSnapshot {
  event: repo.CopEvent;
  counts: repo.CopCounts;
  situationReport: SituationReport | null;
  commandRoles: repo.IcsRoleRow[];
}

export class CommandService {
  constructor(
    private readonly db: Db,
    private readonly audit?: AuditRecorder,
  ) {}

  async getCop(hazardEventId: string): Promise<CopSnapshot> {
    const event = await repo.getEvent(this.db, hazardEventId);
    if (!event) throw new Error('Hazard event not found');

    const placePath = await repo.eventPlacePath(this.db, hazardEventId);
    const [counts, sitrep, commandRoles] = await Promise.all([
      repo.getCopCounts(this.db, hazardEventId, placePath),
      placePath ? situationReport(this.db, event.place_id as string, hazardEventId) : Promise.resolve(null),
      repo.listActiveRoles(this.db, hazardEventId),
    ]);

    return { event, counts, situationReport: sitrep, commandRoles };
  }

  eventPlacePath(hazardEventId: string) {
    return repo.eventPlacePath(this.db, hazardEventId);
  }

  async assignRole(hazardEventId: string, roleTitle: string, userId: string, assignedBy: string): Promise<repo.IcsRoleRow> {
    const role = await repo.assignRole(this.db, hazardEventId, roleTitle, userId, assignedBy);
    await this.audit?.record({
      actorId: assignedBy,
      action: 'command.role_assigned',
      resourceType: 'incident_command_role',
      resourceId: role.id,
      placeId: null,
      metadata: { hazardEventId, roleTitle, userId },
    });
    return role;
  }

  async relieveRole(id: string, actorId: string): Promise<repo.IcsRoleRow> {
    const role = await repo.relieveRole(this.db, id);
    if (!role) throw new Error('Role assignment not found');
    await this.audit?.record({
      actorId,
      action: 'command.role_relieved',
      resourceType: 'incident_command_role',
      resourceId: id,
      placeId: null,
      metadata: { hazardEventId: role.hazard_event_id, roleTitle: role.role_title },
    });
    return role;
  }
}
