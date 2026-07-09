/**
 * Citizen incident reporting service — submit (with auto-corroboration), verify
 * (with reputation update), and promote to a hazard event. Everything audited.
 */
import type { CapSeverity, HazardType } from '@nexus/shared';
import type { Db } from '../../shared/db';
import type { AuditRecorder } from '../../core/audit/audit.service';
import type { GeographyService } from '../../core/geography/geography.service';
import type { HazardService } from '../hazards/hazards.service';
import type { BadgeService } from './badges.service';
import * as repo from './reports.repository';
import type { IncidentReport } from './reports.repository';
import { applyReputationDelta, computeInitialConfidence, corroborationConfidence } from './reports.trust';

const CORROBORATION_KM = 5;
const CORROBORATION_HOURS = 24;

export interface SubmitReportInput {
  hazardType?: HazardType | null;
  placeId?: string | null;
  lng?: number | null;
  lat?: number | null;
  title: string;
  description?: string | null;
  media?: string[];
  source?: 'pwa' | 'sms' | 'whatsapp' | 'voice';
  reporterPhone?: string | null;
}

export class ReportsService {
  constructor(
    private readonly db: Db,
    private readonly geography: GeographyService,
    private readonly hazards: HazardService,
    private readonly audit?: AuditRecorder,
    private readonly badges?: BadgeService,
  ) {}

  getReport(id: string) {
    return repo.getReport(this.db, id);
  }
  listReports(filter: Parameters<typeof repo.listReports>[1]) {
    return repo.listReports(this.db, filter);
  }
  reportPlacePath(id: string) {
    return repo.getReportPlacePath(this.db, id);
  }

  /** Submit a report: resolve place, seed confidence from reputation, auto-corroborate. */
  async submit(input: SubmitReportInput, reporterId?: string | null): Promise<IncidentReport> {
    // resolve place from coordinates when not provided
    let placeId = input.placeId ?? null;
    if (!placeId && input.lng != null && input.lat != null) {
      placeId = (await this.geography.districtForPoint({ lng: input.lng, lat: input.lat }))?.id ?? null;
    }

    const reputation = reporterId ? await repo.getReputation(this.db, reporterId) : 0;
    const report = await repo.insertReport(this.db, {
      reporterId: reporterId ?? null,
      reporterPhone: input.reporterPhone ?? null,
      hazardType: input.hazardType ?? null,
      placeId,
      lng: input.lng ?? null,
      lat: input.lat ?? null,
      title: input.title,
      description: input.description ?? null,
      media: input.media ?? [],
      confidence: computeInitialConfidence(reputation),
      source: input.source ?? 'pwa',
    });

    // auto-corroboration: cluster nearby recent reports of the same hazard
    if (input.lng != null && input.lat != null) {
      const nearby = await repo.findNearbyReports(this.db, {
        hazardType: input.hazardType ?? null,
        lng: input.lng,
        lat: input.lat,
        km: CORROBORATION_KM,
        hours: CORROBORATION_HOURS,
        excludeId: report.id,
      });
      if (nearby.length > 0) {
        const clusterId = nearby.find((n) => n.cluster_id)?.cluster_id ?? nearby[0].id;
        const ids = [report.id, ...nearby.map((n) => n.id)];
        await repo.assignCluster(this.db, ids, clusterId);
        const size = await repo.clusterSize(this.db, clusterId);
        await repo.updateClusterConfidence(this.db, clusterId, size, corroborationConfidence(size));
      }
    }

    await this.audit?.record({
      actorId: reporterId ?? null,
      action: 'report.submitted',
      resourceType: 'incident_report',
      resourceId: report.id,
      placeId,
      metadata: { hazardType: input.hazardType ?? null, source: input.source ?? 'pwa' },
    });

    return (await repo.getReport(this.db, report.id)) as IncidentReport;
  }

  /** Verify or reject a report; adjusts the reporter's reputation. */
  async review(
    id: string,
    reviewerId: string,
    decision: 'verified' | 'rejected',
    reason?: string,
  ): Promise<IncidentReport> {
    const report = await repo.getReport(this.db, id);
    if (!report) throw new Error('Report not found');
    await repo.setVerification(this.db, { id, status: decision, reviewerId, reason });

    if (report.reporter_id) {
      const rep = await repo.getReputation(this.db, report.reporter_id);
      await repo.setReputation(this.db, report.reporter_id, applyReputationDelta(rep, decision));

      // Light gamification (Module C): a verification is the only event that can newly
      // qualify a reporter for a badge (raises both verified-count and reputation).
      // Never let a badge-award failure block the actual verification decision.
      if (decision === 'verified') {
        try {
          await this.badges?.checkAndAward(report.reporter_id);
        } catch (err) {
          console.error('[badges] checkAndAward failed for user', report.reporter_id, (err as Error).message);
        }
      }
    }

    await this.audit?.record({
      actorId: reviewerId,
      action: `report.${decision}`,
      resourceType: 'incident_report',
      resourceId: id,
      placeId: report.place_id,
      metadata: { decision, reason },
    });
    return (await repo.getReport(this.db, id)) as IncidentReport;
  }

  /** Promote a report into a hazard event (creates the event, links the report). */
  async promote(
    id: string,
    reviewerId: string,
    opts: { hazardType?: HazardType; severity?: CapSeverity; title?: string },
  ): Promise<{ reportId: string; eventId: string }> {
    const report = await repo.getReport(this.db, id);
    if (!report) throw new Error('Report not found');
    const hazardType = (opts.hazardType ?? report.hazard_type) as HazardType | undefined;
    if (!hazardType) throw new Error('hazardType is required to promote a report');

    const event = await this.hazards.raiseEvent(
      {
        hazardType,
        placeId: report.place_id,
        title: opts.title ?? report.title,
        description: `Promoted from citizen report ${id}`,
        state: 'watch',
        severity: opts.severity ?? null,
        certainty: 'likely',
        confidence: report.confidence,
        source: 'manual',
      },
      reviewerId,
    );
    await repo.setPromoted(this.db, id, event.id);

    await this.audit?.record({
      actorId: reviewerId,
      action: 'report.promoted',
      resourceType: 'incident_report',
      resourceId: id,
      placeId: report.place_id,
      metadata: { eventId: event.id, hazardType },
    });
    return { reportId: id, eventId: event.id };
  }
}
