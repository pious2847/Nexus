/**
 * Hazard service — the lifecycle brain. Creating and transitioning events goes
 * through here so the state machine is enforced, transitions are recorded, and
 * everything is audited (spec 01 §4). Prediction/evaluator strategies plug in
 * later behind this same service.
 */
import { SEVERITY_COLORS, type CapSeverity, type HazardEventState } from '@nexus/shared';
import type { Db } from '../../shared/db';
import type { AuditRecorder } from '../../core/audit/audit.service';
import * as repo from './hazards.repository';
import type { CreateEventInput, HazardEvent } from './hazards.repository';
import { assertTransition, isTerminal } from './hazards.state';

export interface RaiseEventInput {
  hazardType: string;
  placeId?: string | null;
  title: string;
  description?: string | null;
  state?: HazardEventState; // default 'predicted'
  severity?: CapSeverity | null;
  urgency?: string | null;
  certainty?: string | null;
  confidence?: number | null;
  expiresAt?: Date | null;
  source?: 'manual' | 'auto';
}

export class HazardService {
  constructor(
    private readonly db: Db,
    private readonly audit?: AuditRecorder,
  ) {}

  listHazardTypes() {
    return repo.listHazardTypes(this.db);
  }

  listEvents(filter: Parameters<typeof repo.listEvents>[1]) {
    return repo.listEvents(this.db, filter);
  }

  getEvent(id: string) {
    return repo.getEvent(this.db, id);
  }

  eventTransitions(id: string) {
    return repo.listTransitions(this.db, id);
  }

  eventPlacePath(id: string) {
    return repo.getEventPlacePath(this.db, id);
  }

  /** Raise a new hazard event (records the initial transition + audit). */
  async raiseEvent(input: RaiseEventInput, actorId?: string | null): Promise<HazardEvent> {
    const state = input.state ?? 'predicted';
    const color = input.severity ? SEVERITY_COLORS[input.severity] : null;
    const create: CreateEventInput = {
      hazardType: input.hazardType,
      placeId: input.placeId ?? null,
      state,
      severity: input.severity ?? null,
      urgency: input.urgency ?? null,
      certainty: input.certainty ?? null,
      color,
      title: input.title,
      description: input.description ?? null,
      confidence: input.confidence ?? null,
      startedAt: state === 'active' ? new Date() : null,
      expiresAt: input.expiresAt ?? null,
      source: input.source ?? 'manual',
      createdBy: actorId ?? null,
    };
    const event = await repo.insertEvent(this.db, create);
    await repo.insertTransition(this.db, { eventId: event.id, fromState: null, toState: state, actorId, reason: 'created' });
    await this.audit?.record({
      actorId: actorId ?? null,
      action: 'hazard.event.created',
      resourceType: 'hazard_event',
      resourceId: event.id,
      placeId: event.place_id,
      metadata: { hazardType: event.hazard_type, state, severity: event.severity },
    });
    return event;
  }

  /** Transition an event to a new state (validated + recorded + audited). */
  async transition(
    id: string,
    toState: HazardEventState,
    actorId?: string | null,
    reason?: string,
  ): Promise<HazardEvent> {
    const event = await repo.getEvent(this.db, id);
    if (!event) throw new Error('Hazard event not found');
    const from = event.state as HazardEventState;
    assertTransition(from, toState);

    await repo.updateEventState(this.db, id, toState, {
      setStartedAt: toState === 'active',
      setClosedAt: isTerminal(toState),
    });
    await repo.insertTransition(this.db, {
      eventId: id,
      fromState: from,
      toState,
      actorId,
      reason,
      snapshot: { severity: event.severity, urgency: event.urgency, certainty: event.certainty },
    });
    await this.audit?.record({
      actorId: actorId ?? null,
      action: 'hazard.event.transition',
      resourceType: 'hazard_event',
      resourceId: id,
      placeId: event.place_id,
      metadata: { from, to: toState, reason },
    });

    return (await repo.getEvent(this.db, id)) as HazardEvent;
  }

  addPrediction(input: Parameters<typeof repo.insertPrediction>[1]) {
    return repo.insertPrediction(this.db, input);
  }
}
