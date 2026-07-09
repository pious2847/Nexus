/**
 * Drought evaluator (evaluator_key = 'rules', source = Open-Meteo historical
 * archive). Slow-onset hazard: compares the current 30-day rainfall to the
 * average of the same 30-day calendar window in prior years (a rolling
 * "normal" — true CHIRPS climatology is a future upgrade, spec 01 §17).
 * `deficitPercent` / `classifyDrought` / `sumWindow` are pure + unit-tested.
 */
import type { CapSeverity } from '@nexus/shared';
import type { Db } from '../../../shared/db';
import type { HazardService } from '../hazards.service';
import { findOpenAutoEvent } from '../hazards.repository';
import { fetchHistoricalDailyPrecip } from '../../../integrations/openMeteo';

export const WINDOW_DAYS = 30;
export const HISTORY_YEARS = 3;
/** A yearly window needs at least this fraction of days present to be trusted. */
const MIN_COVERAGE = 0.8;

const round2 = (n: number) => Math.round(n * 100) / 100;
const toIso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, days: number) => new Date(d.getTime() + days * 86_400_000);
const addYears = (d: Date, years: number) => {
  const c = new Date(d.getTime());
  c.setUTCFullYear(c.getUTCFullYear() + years);
  return c;
};

/** Sum precipitation over `days` ending at (and including) `endIso`, using a date->mm map. */
export function sumWindow(byDate: Map<string, number>, endIso: string, days: number): { total: number; coverage: number } {
  const end = new Date(`${endIso}T00:00:00Z`);
  let total = 0;
  let found = 0;
  for (let i = 0; i < days; i++) {
    const iso = toIso(addDays(end, -i));
    const mm = byDate.get(iso);
    if (mm !== undefined) {
      total += mm;
      found++;
    }
  }
  return { total: round2(total), coverage: round2(found / days) };
}

/** % rainfall deficit vs. normal, clamped to [0,100]. 0 if normal is 0 (no meaningful signal). */
export function deficitPercent(current: number, normal: number): number {
  if (normal <= 0) return 0;
  return round2(Math.max(0, Math.min(100, ((normal - current) / normal) * 100)));
}

export interface DroughtClassification {
  severity: CapSeverity | null;
  deficitPercent: number;
}

/** Classify a rainfall deficit % into severity, or null if below the advisory threshold. */
export function classifyDrought(deficit: number): DroughtClassification {
  let severity: CapSeverity | null;
  if (deficit >= 80) severity = 'severe';
  else if (deficit >= 60) severity = 'moderate';
  else if (deficit >= 40) severity = 'minor';
  else severity = null;
  return { severity, deficitPercent: deficit };
}

export interface DroughtTarget {
  placeId: string;
  name: string;
  lat: number;
  lng: number;
}
export interface DroughtDeps {
  db: Db;
  hazards: HazardService;
}
export interface DroughtSummary {
  evaluated: number;
  created: string[];
  updated: string[];
  skipped: string[]; // insufficient historical coverage
}

export class DroughtEvaluator {
  constructor(private readonly deps: DroughtDeps) {}

  async run(targets: DroughtTarget[]): Promise<DroughtSummary> {
    const { db, hazards } = this.deps;
    const created: string[] = [];
    const updated: string[] = [];
    const skipped: string[] = [];

    const end = addDays(new Date(), -1); // yesterday: today's data may be incomplete
    const start = addDays(addYears(end, -HISTORY_YEARS), -WINDOW_DAYS);
    const endIso = toIso(end);

    for (const t of targets) {
      const series = await fetchHistoricalDailyPrecip(t.lat, t.lng, toIso(start), endIso);
      const byDate = new Map(series.days.map((d) => [d.date, d.precipMm]));

      const current = sumWindow(byDate, endIso, WINDOW_DAYS);
      const yearly: number[] = [];
      for (let y = 1; y <= HISTORY_YEARS; y++) {
        const w = sumWindow(byDate, toIso(addYears(end, -y)), WINDOW_DAYS);
        if (w.coverage >= MIN_COVERAGE) yearly.push(w.total);
      }
      if (current.coverage < MIN_COVERAGE || yearly.length === 0) {
        skipped.push(t.placeId);
        continue;
      }

      const normal = round2(yearly.reduce((a, b) => a + b, 0) / yearly.length);
      const deficit = deficitPercent(current.total, normal);
      const cls = classifyDrought(deficit);

      let eventId: string | null = null;
      if (cls.severity) {
        const existing = await findOpenAutoEvent(db, 'drought', t.placeId, 24 * 7); // weekly cadence
        if (existing) {
          eventId = existing.id;
          updated.push(eventId);
        } else {
          const event = await hazards.raiseEvent(
            {
              hazardType: 'drought',
              placeId: t.placeId,
              title: `Drought watch — ${t.name}`,
              description: `${WINDOW_DAYS}-day rainfall ${current.total}mm vs. ${HISTORY_YEARS}-yr normal ${normal}mm (${deficit}% deficit).`,
              state: 'watch',
              severity: cls.severity,
              certainty: 'likely',
              urgency: 'future', // slow-onset
              confidence: round2(0.4 + yearly.length * 0.15), // more historical years -> more confidence
              source: 'auto',
            },
            null,
          );
          eventId = event.id;
          created.push(eventId);
        }
      }

      // Log every successfully-evaluated target, not just alert-worthy ones (Module I
      // gap) — a complete forecast-vs-actual dataset (including "no risk" results,
      // hazardEventId: null) is what future ML training needs; only genuinely
      // insufficient-data cases (the `skipped` continue above) are left unlogged.
      await hazards.addPrediction({
        hazardType: 'drought',
        placeId: t.placeId,
        hazardEventId: eventId,
        riskScore: round2(deficit / 100),
        confidence: round2(0.4 + yearly.length * 0.15),
        factors: { rainfall_mm_30d: current.total, normal_mm_30d: normal, deficit_pct: deficit, years_sampled: yearly.length },
        sources: ['open-meteo-archive'],
        evaluatorKey: 'rules',
      });
    }

    return { evaluated: targets.length, created, updated, skipped };
  }
}
