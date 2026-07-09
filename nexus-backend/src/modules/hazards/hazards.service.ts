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
import { computeImpact } from './impact';
import type { AnticipatoryService } from '../anticipatory/anticipatory.service';

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
    private readonly anticipatory?: AnticipatoryService,
  ) {}

  listHazardTypes() {
    return repo.listHazardTypes(this.db);
  }

  /** Runtime threshold/config edit (Module L) — audited since it changes evaluator behavior platform-wide. */
  async updateHazardType(code: string, patch: repo.HazardTypePatch, actorId?: string | null) {
    const before = await repo.updateHazardType(this.db, code, {});
    if (!before) throw new Error('Hazard type not found');
    const updated = await repo.updateHazardType(this.db, code, patch);
    // resourceId is a UUID column; hazard_types.code (e.g. 'flood') isn't one, so it's
    // carried in metadata instead — a non-UUID resourceId would just silently fail to
    // record (AuditService swallows bad entries by design), losing this audit line.
    await this.audit?.record({
      actorId: actorId ?? null,
      action: 'hazard.type.updated',
      resourceType: 'hazard_type',
      resourceId: null,
      placeId: null,
      metadata: { code, changed: Object.keys(patch), patch },
    });
    return updated;
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

    // Impact-based forecasting: who/what is in the affected area (spec 01 §9).
    // Never let an impact failure block event creation.
    if (event.place_id) {
      try {
        const impact = await computeImpact(this.db, event.place_id);
        if (impact) {
          await repo.updateEventImpact(this.db, event.id, impact);
          event.impact_summary = impact;
        }
      } catch (err) {
        console.error('[impact] compute failed for event', event.id, (err as Error).message);
      }
    }

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

    const updated = (await repo.getEvent(this.db, id)) as HazardEvent;

    // Anticipatory action (N12): fire-once forecast-based protocols keyed on
    // (hazard_type, place, trigger_state). Never blocks the transition itself.
    if (updated.place_id) {
      try {
        await this.anticipatory?.checkAndActivate({
          id: updated.id,
          hazardType: updated.hazard_type,
          placeId: updated.place_id,
          state: toState,
        });
      } catch (err) {
        console.error('[anticipatory] checkAndActivate failed for event', id, (err as Error).message);
      }
    }

    return updated;
  }

  addPrediction(input: Parameters<typeof repo.insertPrediction>[1]) {
    return repo.insertPrediction(this.db, input);
  }
}
