/**
 * Volunteer roster service (Module M — Emergency Response & Coordination).
 * Every list is scoped to a geography subtree; every mutation is audited;
 * `matchForTask` is the "match volunteers to incidents by proximity & skill"
 * feature — available volunteers whose base place shares lineage with the
 * task's place (bidirectional ltree, same idea as `alerts.repository.ts`'s
 * `findSubscribers`), optionally filtered by skill.
 */
import type { Db } from '../../../shared/db';
import type { AuditRecorder } from '../../../core/audit/audit.service';
import type { GeographyService } from '../../../core/geography/geography.service';
import * as repo from './volunteer.repository';
import type { VolunteerRow, UpdateVolunteerPatch } from './volunteer.repository';

export interface RegisterVolunteerInput {
  userId?: string | null;
  name: string;
  phone?: string | null;
  placeId: string;
  skills?: string[];
}

export class VolunteerService {
  constructor(
    private readonly db: Db,
    private readonly geography: GeographyService,
    private readonly audit?: AuditRecorder,
  ) {}

  async register(input: RegisterVolunteerInput, registeredBy?: string | null): Promise<VolunteerRow> {
    const volunteer = await repo.insertVolunteer(this.db, { ...input, registeredBy: registeredBy ?? null });
    await this.audit?.record({
      actorId: registeredBy ?? null,
      action: 'volunteer.registered',
      resourceType: 'volunteer',
      resourceId: volunteer.id,
      placeId: volunteer.place_id,
      metadata: { skills: volunteer.skills },
    });
    return volunteer;
  }

  getVolunteer(id: string) {
    return repo.getVolunteer(this.db, id);
  }

  volunteerPlacePath(id: string) {
    return repo.getVolunteerPlacePath(this.db, id);
  }

  listByScope(scopePlaceId: string, filter: Parameters<typeof repo.listByScope>[2] = {}) {
    return repo.listByScope(this.db, scopePlaceId, filter);
  }

  async update(id: string, patch: UpdateVolunteerPatch, actorId?: string | null): Promise<VolunteerRow> {
    const before = await repo.getVolunteer(this.db, id);
    if (!before) throw new Error('Volunteer record not found');
    const updated = await repo.updateVolunteer(this.db, id, patch);
    if (!updated) throw new Error('Volunteer record not found');
    await this.audit?.record({
      actorId: actorId ?? null,
      action: 'volunteer.updated',
      resourceType: 'volunteer',
      resourceId: id,
      placeId: before.place_id,
      metadata: { changed: Object.keys(patch), patch },
    });
    return updated;
  }

  /** Assign a volunteer to a dispatch task: sets assigned_task + availability: 'deployed'. */
  async assignToTask(id: string, taskId: string, actorId?: string | null): Promise<VolunteerRow> {
    const before = await repo.getVolunteer(this.db, id);
    if (!before) throw new Error('Volunteer record not found');
    const updated = await repo.updateVolunteer(this.db, id, { assignedTask: taskId, availability: 'deployed' });
    if (!updated) throw new Error('Volunteer record not found');
    await this.audit?.record({
      actorId: actorId ?? null,
      action: 'volunteer.assigned',
      resourceType: 'volunteer',
      resourceId: id,
      placeId: before.place_id,
      metadata: { taskId },
    });
    return updated;
  }

  /** Match available volunteers to a task's place, optionally filtered by skill. */
  matchForTask(taskPlacePath: string, requiredSkill?: string, limit = 10): Promise<VolunteerRow[]> {
    return repo.findAvailableNear(this.db, taskPlacePath, { skill: requiredSkill, limit });
  }

  /** Resolve a place from coordinates (mirrors health-facility.service's resolvePlace). */
  async resolvePlace(lng?: number, lat?: number): Promise<string | null> {
    if (lng == null || lat == null) return null;
    return (await this.geography.districtForPoint({ lng, lat }))?.id ?? null;
  }
}
