/**
 * Anticipatory action / forecast-based triggers (N12). A "protocol" is a
 * pre-agreed rule: if a hazard event of `hazardType` reaches `triggerState`
 * in `placeId` (or a descendant place), automatically run `actions`
 * (pre-alert focal persons, flag vulnerable persons for evacuation
 * priority, log a relief pre-positioning note).
 *
 * `checkAndActivate()` is the method the hazard-event transition path calls
 * (NOT wired in from this module — see README "Wiring needed"). It must
 * never throw for "nothing matched" / "already activated" — only for
 * genuine errors — since it runs inline with every hazard-event transition.
 *
 * Every optional dependency (audit, focalPoints, vulnerablePersons) no-ops
 * cleanly if omitted, same graceful-degrade pattern as AlertsService/SosService,
 * so this class type-checks and works even before the orchestrator wires
 * focal points / vulnerable persons in.
 */
import type { Db } from '../../shared/db';
import type { AuditRecorder } from '../../core/audit/audit.service';
import type { GeographyService } from '../../core/geography/geography.service';
import type { FocalPointService } from '../alerts/focal/focal-point.service';
import type { VulnerablePersonsService } from '../vulnerable/vulnerable.service';
import { sendSms as defaultSendSms, type SmsResult } from '../../integrations/arkesel';
import { sendEmail as defaultSendEmail, type EmailResult } from '../../integrations/email';
import * as repo from './anticipatory.repository';
import type { ProtocolRow, ProtocolAction, ListProtocolFilter, UpdateProtocolPatch } from './anticipatory.repository';

type SmsSender = (to: string, message: string) => Promise<SmsResult>;
type EmailSender = (to: string, subject: string, html: string, text?: string) => Promise<EmailResult>;

export interface CreateProtocolInput {
  name: string;
  hazardType: string;
  placeId: string;
  triggerState: string;
  actions: ProtocolAction[];
  active?: boolean;
}

export interface HazardEventForActivation {
  id: string;
  hazardType: string;
  placeId: string;
  state: string;
}

export interface ActionResult {
  type: string;
  params: Record<string, unknown>;
  result: Record<string, unknown>;
}

export interface ActivationResult {
  protocolId: string;
  hazardEventId: string;
  activationId: string;
  actionsTaken: ActionResult[];
}

export class AnticipatoryService {
  constructor(
    private readonly db: Db,
    private readonly geography: GeographyService,
    private readonly audit?: AuditRecorder,
    private readonly focalPoints?: FocalPointService,
    private readonly vulnerablePersons?: VulnerablePersonsService,
    private readonly sendSms: SmsSender = defaultSendSms,
    private readonly sendEmail: EmailSender = defaultSendEmail,
  ) {}

  async createProtocol(input: CreateProtocolInput, createdBy: string): Promise<ProtocolRow> {
    const protocol = await repo.insertProtocol(this.db, { ...input, createdBy });
    await this.audit?.record({
      actorId: createdBy,
      action: 'anticipatory.protocol_created',
      resourceType: 'anticipatory_protocol',
      resourceId: protocol.id,
      placeId: protocol.place_id,
      metadata: { hazardType: protocol.hazard_type, triggerState: protocol.trigger_state },
    });
    return protocol;
  }

  getProtocol(id: string) {
    return repo.getProtocol(this.db, id);
  }

  protocolPlacePath(id: string) {
    return repo.protocolPlacePath(this.db, id);
  }

  /** List a district/region's configured protocols. */
  listByScope(scopePlaceId: string, filter: ListProtocolFilter = {}): Promise<ProtocolRow[]> {
    return repo.listProtocolsByScope(this.db, scopePlaceId, filter);
  }

  async updateProtocol(id: string, patch: UpdateProtocolPatch, actorId: string): Promise<ProtocolRow> {
    const before = await repo.getProtocol(this.db, id);
    if (!before) throw new Error('Anticipatory protocol not found');
    const updated = await repo.updateProtocol(this.db, id, patch);
    if (!updated) throw new Error('Anticipatory protocol not found');
    await this.audit?.record({
      actorId,
      action: 'anticipatory.protocol_updated',
      resourceType: 'anticipatory_protocol',
      resourceId: id,
      placeId: before.place_id,
      metadata: { changed: Object.keys(patch), patch },
    });
    return updated;
  }

  listActivations(scopePlaceId: string) {
    return repo.listActivationsByScope(this.db, scopePlaceId);
  }

  /**
   * Finds every active protocol matching this hazard event's (hazardType,
   * state) whose configured place covers the event's place, and executes
   * each one that hasn't already fired for this event. Returns the
   * activations actually created this call — empty array if nothing
   * matched or everything matching had already activated. Never throws for
   * "nothing to do", only for genuine errors (e.g. a DB outage).
   */
  async checkAndActivate(hazardEvent: HazardEventForActivation): Promise<ActivationResult[]> {
    const matches = await repo.findMatchingActiveProtocols(
      this.db,
      hazardEvent.hazardType,
      hazardEvent.placeId,
      hazardEvent.state,
    );
    if (matches.length === 0) return [];

    const place = await this.geography.getById(hazardEvent.placeId);
    const placePath = place?.path ?? null;

    const results: ActivationResult[] = [];
    for (const protocol of matches) {
      const already = await repo.hasActivated(this.db, protocol.id, hazardEvent.id);
      if (already) continue;

      const actionsTaken: ActionResult[] = [];
      for (const action of protocol.actions ?? []) {
        actionsTaken.push(await this.executeAction(action, protocol, hazardEvent, placePath));
      }

      const inserted = await repo.insertActivation(this.db, protocol.id, hazardEvent.id, actionsTaken);
      if (!inserted) continue; // lost the race against the unique constraint — already activated

      await this.audit?.record({
        actorId: null,
        action: 'anticipatory.protocol_activated',
        resourceType: 'anticipatory_protocol',
        resourceId: protocol.id,
        placeId: hazardEvent.placeId,
        metadata: {
          hazardEventId: hazardEvent.id,
          hazardType: hazardEvent.hazardType,
          triggerState: hazardEvent.state,
          actionsTaken,
        },
      });

      results.push({
        protocolId: protocol.id,
        hazardEventId: hazardEvent.id,
        activationId: inserted.id,
        actionsTaken,
      });
    }
    return results;
  }

  /** Execute a single protocol action, returning its result for the activation audit log. */
  private async executeAction(
    action: ProtocolAction,
    protocol: ProtocolRow,
    hazardEvent: HazardEventForActivation,
    placePath: string | null,
  ): Promise<ActionResult> {
    switch (action.type) {
      case 'notify_focal_points':
        return { type: action.type, params: action.params, result: await this.notifyFocalPoints(action, protocol, hazardEvent, placePath) };
      case 'flag_vulnerable_evacuation':
        return { type: action.type, params: action.params, result: await this.flagVulnerableEvacuation(hazardEvent.placeId) };
      case 'pre_position_relief':
        return { type: action.type, params: action.params, result: this.prePositionRelief(action) };
      default:
        return { type: action.type, params: action.params, result: { skipped: true, reason: `Unknown action type: ${action.type}` } };
    }
  }

  /**
   * Fan out to every active community focal point covering the triggering
   * hazard event's place — mirrors AlertsService.publish()'s focal-point
   * fan-out (SMS to contact_phone, email to contact_email). No-ops (with a
   * `skipped` result) if `focalPoints` wasn't injected or the place path
   * couldn't be resolved.
   */
  private async notifyFocalPoints(
    action: ProtocolAction,
    protocol: ProtocolRow,
    hazardEvent: HazardEventForActivation,
    placePath: string | null,
  ): Promise<Record<string, unknown>> {
    if (!this.focalPoints || !placePath) {
      return { skipped: true, reason: !this.focalPoints ? 'focalPoints service not injected' : 'place path not resolved' };
    }
    const message =
      (action.params?.message as string | undefined) ??
      `NEXUS ANTICIPATORY ACTION: ${protocol.name} triggered for ${hazardEvent.hazardType} ${hazardEvent.state} in your area. Prepare now.`;

    const points = await this.focalPoints.findActiveByScope(placePath);
    let notified = 0;
    for (const point of points) {
      let delivered = false;
      if (point.contact_phone) {
        const result = await this.sendSms(point.contact_phone, message);
        delivered = delivered || result.sent;
      }
      if (point.contact_email) {
        const result = await this.sendEmail(
          point.contact_email,
          `NEXUS Anticipatory Action — ${protocol.name}`,
          `<pre style="white-space:pre-wrap;font-family:inherit">${message}</pre>`,
          message,
        );
        delivered = delivered || result.sent;
      }
      if (delivered) notified++;
    }
    return { totalFocalPoints: points.length, notified, message };
  }

  /**
   * Queries vulnerable persons in the triggering event's place scope and
   * records the count + ids as a "who needs priority evacuation help"
   * flag. There's no evacuation-flag column to set — the whole point is
   * surfacing the list to responders via the activation log, not mutating
   * the registry. No-ops (with a `skipped` result) if `vulnerablePersons`
   * wasn't injected. `scopePlaceId` is a place id (the hazard event's own
   * place), not an ltree path — `VulnerablePersonsService.listByScope`
   * resolves the subtree internally.
   */
  private async flagVulnerableEvacuation(scopePlaceId: string): Promise<Record<string, unknown>> {
    if (!this.vulnerablePersons) {
      return { skipped: true, reason: 'vulnerablePersons service not injected' };
    }
    const persons = await this.vulnerablePersons.listByScope(scopePlaceId, { status: 'active' });
    return {
      flagged: persons.length,
      personIds: persons.map((p) => p.id),
    };
  }

  /**
   * MVP: no real inventory movement (that would require importing the relief
   * module's repository, out of scope for this isolated build). This just
   * records the recommendation for a human to action — same "deliberately
   * scoped" honesty pattern used for sirens/PA hardware in N6.
   */
  private prePositionRelief(action: ProtocolAction): Record<string, unknown> {
    return {
      itemType: (action.params?.itemType as string | undefined) ?? null,
      note: (action.params?.note as string | undefined) ?? null,
      recorded: true,
    };
  }
}
