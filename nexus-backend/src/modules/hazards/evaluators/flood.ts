/**
 * Flood evaluator (evaluator_key = 'external', source = GloFAS via Open-Meteo).
 * Classifies flood risk by comparing forecast river discharge to historical
 * daily-discharge percentiles at the same point — a simplified proxy for
 * GloFAS's own return-period alert levels (true return-period statistics use
 * annual maxima, not daily percentiles; this is an honest v1 heuristic, same
 * spirit as the drought evaluator's rainfall-deficit proxy for CHIRPS).
 * `percentile` / `classifyFloodRisk` are pure + unit-tested.
 */
import type { CapSeverity } from '@nexus/shared';
import type { Db } from '../../../shared/db';
import type { HazardService } from '../hazards.service';
import { findOpenAutoEvent } from '../hazards.repository';
import { fetchForecastDischarge, fetchHistoricalDischarge } from '../../../integrations/glofas';

export const HISTORY_YEARS = 10;
export const FORECAST_DAYS = 7;
const MIN_HISTORY_DAYS = 365 * 2; // require at least ~2 years of data to trust percentiles

const round2 = (n: number) => Math.round(n * 100) / 100;
const toIso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, days: number) => new Date(d.getTime() + days * 86_400_000);
const addYears = (d: Date, years: number) => {
  const c = new Date(d.getTime());
  c.setUTCFullYear(c.getUTCFullYear() + years);
  return c;
};

/** Linear-interpolation percentile (p in [0,100]) of an unsorted array. */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sorted[lo];
  return round2(sorted[lo] + (sorted[hi] - sorted[lo]) * (rank - lo));
}

export interface FloodClassification {
  severity: CapSeverity | null;
  currentMax: number;
  p90: number;
  p95: number;
  p98: number;
}

/** Classify a forecast max discharge against historical percentile thresholds. */
export function classifyFloodRisk(currentMax: number, p90: number, p95: number, p98: number): FloodClassification {
  let severity: CapSeverity | null;
  if (currentMax >= p98) severity = 'severe';
  else if (currentMax >= p95) severity = 'moderate';
  else if (currentMax >= p90) severity = 'minor';
  else severity = null;
  return { severity, currentMax, p90, p95, p98 };
}

export interface FloodTarget {
  placeId: string;
  name: string;
  lat: number;
  lng: number;
}
export interface FloodDeps {
  db: Db;
  hazards: HazardService;
}
export interface FloodSummary {
  evaluated: number;
  created: string[];
  updated: string[];
  skipped: string[];
}

export class FloodEvaluator {
  constructor(private readonly deps: FloodDeps) {}

  async run(targets: FloodTarget[]): Promise<FloodSummary> {
    const { db, hazards } = this.deps;
    const created: string[] = [];
    const updated: string[] = [];
    const skipped: string[] = [];

    const histEnd = addDays(new Date(), -1);
    const histStart = addYears(histEnd, -HISTORY_YEARS);

    for (const t of targets) {
      const [historical, forecast] = await Promise.all([
        fetchHistoricalDischarge(t.lat, t.lng, toIso(histStart), toIso(histEnd)),
        fetchForecastDischarge(t.lat, t.lng, FORECAST_DAYS),
      ]);

      if (historical.days.length < MIN_HISTORY_DAYS || forecast.days.length === 0) {
        skipped.push(t.placeId);
        continue;
      }

      const histValues = historical.days.map((d) => d.dischargeM3s);
      const p90 = percentile(histValues, 90);
      const p95 = percentile(histValues, 95);
      const p98 = percentile(histValues, 98);
      const currentMax = Math.max(...forecast.days.map((d) => d.dischargeM3s));

      const cls = classifyFloodRisk(currentMax, p90, p95, p98);

      let eventId: string | null = null;
      if (cls.severity) {
        const existing = await findOpenAutoEvent(db, 'flood', t.placeId, 24);
        if (existing) {
          eventId = existing.id;
          updated.push(eventId);
        } else {
          const event = await hazards.raiseEvent(
            {
              hazardType: 'flood',
              placeId: t.placeId,
              title: `Flood watch — ${t.name}`,
              description: `Forecast river discharge ${currentMax}m³/s vs. historical p90=${p90}, p95=${p95}, p98=${p98} (${HISTORY_YEARS}yr record).`,
              state: 'watch',
              severity: cls.severity,
              certainty: 'likely',
              urgency: 'expected',
              confidence: 0.65,
              source: 'auto',
            },
            null,
          );
          eventId = event.id;
          created.push(eventId);
        }
      }

      // Log every successfully-evaluated target, not just alert-worthy ones (Module I
      // gap) — see drought.ts's identical comment for the reasoning.
      await hazards.addPrediction({
        hazardType: 'flood',
        placeId: t.placeId,
        hazardEventId: eventId,
        riskScore: round2(Math.min(1, currentMax / (p98 || 1))),
        confidence: 0.65,
        factors: { discharge_m3s: round2(currentMax), p90, p95, p98, history_years: HISTORY_YEARS },
        sources: ['glofas'],
        evaluatorKey: 'external',
      });
    }

    return { evaluated: targets.length, created, updated, skipped };
  }
}
