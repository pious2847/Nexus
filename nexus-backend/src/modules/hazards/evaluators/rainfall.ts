/**
 * Heavy-rainfall evaluator (evaluator_key = 'rules', source = Open-Meteo).
 * Forecast precipitation per place → auto `heavy_rainfall` events. Thresholds
 * mirror the hazard_types config. `classifyRainfall` is pure + unit-tested.
 *
 * NOTE: the DB ingestion path (`run`) is written but not yet DB-verified — it
 * awaits a working database credential (mirrors the FIRMS bushfire evaluator,
 * which is fully verified).
 */
import type { CapSeverity } from '@nexus/shared';
import type { Db } from '../../../shared/db';
import type { HazardService } from '../hazards.service';
import { findOpenAutoEvent } from '../hazards.repository';
import { fetchDailyPrecip } from '../../../integrations/openMeteo';

export interface RainfallClassification {
  severity: CapSeverity | null; // null = below advisory threshold (no event)
  riskScore: number;
  factors: Record<string, number>;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Classify 24h forecast rainfall (mm) into a severity, or null if below threshold. */
export function classifyRainfall(mm24h: number): RainfallClassification {
  let severity: CapSeverity | null;
  if (mm24h >= 50) severity = 'severe';
  else if (mm24h >= 30) severity = 'moderate';
  else if (mm24h >= 15) severity = 'minor';
  else severity = null;
  return { severity, riskScore: round2(Math.min(1, mm24h / 80)), factors: { rainfall_mm_24h: round2(mm24h) } };
}

export interface RainfallTarget {
  placeId: string;
  name: string;
  lat: number;
  lng: number;
}

export interface RainfallDeps {
  db: Db;
  hazards: HazardService;
}

export interface RainfallSummary {
  evaluated: number;
  created: string[];
  updated: string[];
}

export class RainfallEvaluator {
  constructor(private readonly deps: RainfallDeps) {}

  /** Evaluate a set of places (by centroid); raise/update heavy_rainfall events. */
  async run(targets: RainfallTarget[]): Promise<RainfallSummary> {
    const { db, hazards } = this.deps;
    const created: string[] = [];
    const updated: string[] = [];

    for (const t of targets) {
      const forecast = await fetchDailyPrecip(t.lat, t.lng);
      const cls = classifyRainfall(forecast.maxMm);
      if (!cls.severity) continue; // below advisory threshold

      const existing = await findOpenAutoEvent(db, 'heavy_rainfall', t.placeId, 12);
      let eventId: string;
      if (existing) {
        eventId = existing.id;
        updated.push(eventId);
      } else {
        const event = await hazards.raiseEvent(
          {
            hazardType: 'heavy_rainfall',
            placeId: t.placeId,
            title: `Heavy rainfall forecast — ${t.name}`,
            description: `Forecast up to ${cls.factors.rainfall_mm_24h} mm in 24h.`,
            state: 'watch',
            severity: cls.severity,
            certainty: 'expected',
            urgency: 'future',
            confidence: 0.6,
            source: 'auto',
          },
          null,
        );
        eventId = event.id;
        created.push(eventId);
      }

      await hazards.addPrediction({
        hazardType: 'heavy_rainfall',
        placeId: t.placeId,
        hazardEventId: eventId,
        riskScore: cls.riskScore,
        confidence: 0.6,
        factors: cls.factors,
        sources: ['open-meteo'],
        evaluatorKey: 'rules',
      });
    }

    return { evaluated: targets.length, created, updated };
  }
}
