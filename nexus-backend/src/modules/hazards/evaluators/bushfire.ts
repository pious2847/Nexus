/**
 * Bushfire evaluator (evaluator_key = 'external'). Turns NASA FIRMS active-fire
 * detections into per-district hazard signals, then raises/updates auto hazard
 * events. `classifyBushfire` is pure + unit-tested; ingestion is DB-backed.
 *
 * Auto events are created in `watch` (conservative) with the computed severity;
 * officers escalate, and public alerting stays gated (tiered authority, spec §11).
 */
import type { CapSeverity } from '@nexus/shared';
import type { GeographyService } from '../../../core/geography/geography.service';
import type { HazardService } from '../hazards.service';
import { findOpenAutoEvent } from '../hazards.repository';
import type { Db } from '../../../shared/db';
import { isHighConfidence, type FirePoint } from '../../../integrations/firms';

export interface DistrictFireStats {
  count: number;
  highConf: number;
  maxFrp: number;
}

export interface BushfireClassification {
  severity: CapSeverity;
  riskScore: number; // 0..1
  confidence: number; // 0..1
  factors: Record<string, number>;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Pure severity/risk classification from aggregated per-district fire stats. */
export function classifyBushfire(a: DistrictFireStats): BushfireClassification {
  let severity: CapSeverity;
  if (a.highConf >= 3 || a.maxFrp >= 50) severity = 'severe';
  else if (a.count >= 3 || a.highConf >= 1) severity = 'moderate';
  else severity = 'minor';

  const riskScore = round2(Math.min(1, a.count * 0.15 + a.highConf * 0.2 + Math.min(a.maxFrp / 100, 0.4)));
  const confidence = round2(a.count > 0 ? Math.min(1, a.highConf / a.count + 0.3) : 0.3);
  return { severity, riskScore, confidence, factors: { count: a.count, highConfidence: a.highConf, maxFrp: a.maxFrp } };
}

export interface BushfireDeps {
  db: Db;
  hazards: HazardService;
  geography: GeographyService;
}

export interface IngestSummary {
  fires: number;
  districts: number;
  created: string[];
  updated: string[];
}

export class BushfireEvaluator {
  constructor(private readonly deps: BushfireDeps) {}

  /** Ingest fire points: group by district, classify, raise/update auto events. */
  async run(points: FirePoint[]): Promise<IngestSummary> {
    const { db, hazards, geography } = this.deps;

    // 1) group detections by containing district
    const byDistrict = new Map<string, DistrictFireStats & { name: string }>();
    for (const fp of points) {
      const district = await geography.districtForPoint({ lng: fp.lng, lat: fp.lat });
      if (!district) continue; // fire outside any district boundary
      const agg = byDistrict.get(district.id) ?? { count: 0, highConf: 0, maxFrp: 0, name: district.name };
      agg.count += 1;
      if (isHighConfidence(fp)) agg.highConf += 1;
      if (fp.frp != null) agg.maxFrp = Math.max(agg.maxFrp, fp.frp);
      byDistrict.set(district.id, agg);
    }

    const created: string[] = [];
    const updated: string[] = [];

    // 2) classify + raise/update one event per district
    for (const [placeId, agg] of byDistrict) {
      const cls = classifyBushfire(agg);
      const existing = await findOpenAutoEvent(db, 'bushfire', placeId, 24);

      let eventId: string;
      if (existing) {
        eventId = existing.id;
        updated.push(eventId);
      } else {
        const event = await hazards.raiseEvent(
          {
            hazardType: 'bushfire',
            placeId,
            title: `Active fire detected — ${agg.name}`,
            description: `${agg.count} FIRMS detection(s) (${agg.highConf} high-confidence, max FRP ${agg.maxFrp} MW).`,
            state: 'watch',
            severity: cls.severity,
            certainty: 'observed',
            urgency: 'immediate',
            confidence: cls.confidence,
            source: 'auto',
          },
          null,
        );
        eventId = event.id;
        created.push(eventId);
      }

      // record the prediction/evidence with provenance either way
      await hazards.addPrediction({
        hazardType: 'bushfire',
        placeId,
        hazardEventId: eventId,
        riskScore: cls.riskScore,
        confidence: cls.confidence,
        factors: cls.factors,
        sources: ['firms'],
        evaluatorKey: 'external',
      });
    }

    return { fires: points.length, districts: byDistrict.size, created, updated };
  }
}
