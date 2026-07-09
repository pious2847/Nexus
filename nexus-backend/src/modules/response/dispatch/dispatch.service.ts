/**
 * Dispatch service — the lifecycle brain for incident tasking, the direct
 * analog of `modules/hazards/hazards.service.ts`. Creating/transitioning a
 * task goes through here so the state machine (`dispatch.state.ts`) is
 * enforced, every status change is recorded in `dispatch_task_events` (the
 * raw material for the orchestrator's after-action timeline), and mutations
 * are audited.
 */
import type { Db } from '../../../shared/db';
import type { AuditRecorder } from '../../../core/audit/audit.service';
import * as repo from './dispatch.repository';
import type { DispatchTaskRow, InsertTaskInput } from './dispatch.repository';
import { assertTransition, isTerminal, type DispatchStatus } from './dispatch.state';

export interface CreateTaskInput {
  hazardEventId?: string | null;
  placeId?: string | null;
  lng?: number | null;
  lat?: number | null;
  taskType: string;
  description?: string | null;
  priority?: string;
  sourceType?: string | null;
  sourceId?: string | null;
}

export class DispatchService {
  constructor(
    private readonly db: Db,
    private readonly audit?: AuditRecorder,
  ) {}

  /** Create a new dispatch task (records the initial 'open' event + audit). */
  async createTask(input: CreateTaskInput, createdBy?: string | null): Promise<DispatchTaskRow> {
    const create: InsertTaskInput = {
      hazardEventId: input.hazardEventId ?? null,
      placeId: input.placeId ?? null,
      lng: input.lng ?? null,
      lat: input.lat ?? null,
      taskType: input.taskType,
      description: input.description ?? null,
      priority: input.priority ?? 'normal',
      sourceType: input.sourceType ?? 'manual',
      sourceId: input.sourceId ?? null,
      createdBy: createdBy ?? null,
    };
    const task = await repo.insertTask(this.db, create);
    await repo.insertTaskEvent(this.db, { taskId: task.id, fromStatus: null, toStatus: 'open', actorId: createdBy, note: 'created' });
    await this.audit?.record({
      actorId: createdBy ?? null,
      action: 'dispatch.task.created',
      resourceType: 'dispatch_task',
      resourceId: task.id,
      placeId: task.place_id,
      metadata: { taskType: task.task_type, priority: task.priority, sourceType: task.source_type },
    });
    return task;
  }

  getTask(id: string) {
    return repo.getTask(this.db, id);
  }

  taskPlacePath(id: string) {
    return repo.getTaskPlacePath(this.db, id);
  }

  listByScope(scopePlaceId: string, filter: Parameters<typeof repo.listByScope>[2] = {}) {
    return repo.listByScope(this.db, scopePlaceId, filter);
  }

  taskEvents(id: string) {
    return repo.listTaskEvents(this.db, id);
  }

  /** Transition a task to a new status (validated + recorded + audited). */
  async transition(id: string, toStatus: DispatchStatus, actorId?: string | null, note?: string): Promise<DispatchTaskRow> {
    const task = await repo.getTask(this.db, id);
    if (!task) throw new Error('Dispatch task not found');
    const from = task.status;
    assertTransition(from, toStatus);

    const updated = await repo.updateTaskStatus(this.db, id, toStatus, { setCompletedAt: toStatus === 'done' });
    await repo.insertTaskEvent(this.db, { taskId: id, fromStatus: from, toStatus, actorId, note });
    await this.audit?.record({
      actorId: actorId ?? null,
      action: 'dispatch.task.transitioned',
      resourceType: 'dispatch_task',
      resourceId: id,
      placeId: task.place_id,
      metadata: { from, to: toStatus, note, terminal: isTerminal(toStatus) },
    });
    return updated as DispatchTaskRow;
  }

  /**
   * Assign a task to a user. If the task is still `open`, this doubles as the
   * open → assigned transition (the common case: dispatching a fresh task to
   * someone). If the task is already past `open` (assigned/in_progress), it's
   * a reassignment — just update `assigned_to` without forcing a status
   * transition, since forcing e.g. in_progress → assigned would violate the
   * forward-only state machine.
   */
  async assign(id: string, assignedTo: string, actorId?: string | null): Promise<DispatchTaskRow> {
    const task = await repo.getTask(this.db, id);
    if (!task) throw new Error('Dispatch task not found');

    if (task.status === 'open') {
      const updated = await repo.updateTaskStatus(this.db, id, 'assigned', { assignedTo });
      await repo.insertTaskEvent(this.db, { taskId: id, fromStatus: 'open', toStatus: 'assigned', actorId, note: `assigned to ${assignedTo}` });
      await this.audit?.record({
        actorId: actorId ?? null,
        action: 'dispatch.task.transitioned',
        resourceType: 'dispatch_task',
        resourceId: id,
        placeId: task.place_id,
        metadata: { from: 'open', to: 'assigned', assignedTo },
      });
      return updated as DispatchTaskRow;
    }

    const updated = await repo.updateTaskAssignee(this.db, id, assignedTo);
    await this.audit?.record({
      actorId: actorId ?? null,
      action: 'dispatch.task.reassigned',
      resourceType: 'dispatch_task',
      resourceId: id,
      placeId: task.place_id,
      metadata: { status: task.status, assignedTo },
    });
    return updated as DispatchTaskRow;
  }
}
