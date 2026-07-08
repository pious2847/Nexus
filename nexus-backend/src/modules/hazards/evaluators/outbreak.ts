/**
 * Outbreak-detection evaluator (evaluator_key = 'rules', source = disease case
 * reports — modules/health/cases). Statistical spike detection: for each
 * (disease, place) with recent activity, compares the current week's case
 * count to a rolling weekly baseline (mean + stdDev over the disease's
 * `baseline_window_days`, expressed in trailing weekly buckets) via a z-score,
 * same "continuous score -> discrete severity" shape as the drought evaluator's
 * rainfall-deficit classification. Raises/updates the existing `disease_outbreak`
 * hazard type (already seeded, thresholds.sigma: 2 — modules/hazards/seed-hazard-types.ts).
 * `computeBaseline` / `zScore` / `classifyOutbreak` are pure + unit-tested.
 */
import type { CapSeverity, CapCertainty } from '@nexus/shared';
import type { Db } from '../../../shared/db';
import type { HazardService } from '../hazards.service';
import { findOpenAutoEvent } from '../hazards.repository';
import { findById as findPlace } from '../../../core/geography/geography.repository';
import {
  listEnabledDiseaseTypes,
  listDistinctPlacesWithRecentCases,
  countByDiseaseAndPlaceInWindow,
} from '../../health/cases/disease-case.repository';

const WEEK_DAYS = 7;
const DAY_MS = 86_400_000;

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Mean + population standard deviation of a set of trailing weekly case
 * counts (the baseline period, BEFORE the current week — the current week is
 * never included in its own baseline). Population (not sample) stdDev is used
 * because the baseline weeks are the entire population of interest for this
 * calculation, not a sample drawn from a larger set.
 */
export function computeBaseline(weeklyCounts: number[]): { mean: number; stdDev: number } {
  const n = weeklyCounts.length;
  if (n === 0) return { mean: 0, stdDev: 0 };
  const mean = weeklyCounts.reduce((a, b) => a + b, 0) / n;
  const variance = weeklyCounts.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  return { mean: round2(mean), stdDev: round2(Math.sqrt(variance)) };
}

/**
 * (current - mean) / stdDev, guarded against a degenerate (all-zero or
 * constant) baseline: stdDev === 0 would otherwise divide to NaN/Infinity.
 * If the baseline is flat and the current count exceeds it, that is itself a
 * strong signal (e.g. a disease with a near-zero baseline suddenly reporting
 * cases) — return a large fixed z (99) rather than NaN so `classifyOutbreak`
 * still fires. If current <= mean, there's no signal at all (0).
 */
export function zScore(current: number, baseline: { mean: number; stdDev: number }): number {
  if (baseline.stdDev === 0) return current > baseline.mean ? 99 : 0;
  return round2((current - baseline.mean) / baseline.stdDev);
}

/**
 * Map a continuous z-score to a discrete CAP severity, or null below the
 * disease's alert threshold (no event). Mirrors classifyDrought's shape: one
 * "sigma-width" band per severity step above the alert threshold —
 *   [alertSigma, alertSigma+1)   -> minor    (just crossed the spike threshold)
 *   [alertSigma+1, alertSigma+2) -> moderate (a full extra sigma of excess)
 *   [alertSigma+2, ∞)            -> severe   (two extra sigma — a sharp spike)
 * alertSigma itself is per-disease (disease_types.alert_sigma), defaulting to
 * 2 to match the disease_outbreak hazard type's seeded threshold.
 */
export function classifyOutbreak(z: number, alertSigma: number): CapSeverity | null {
  if (z < alertSigma) return null;
  if (z < alertSigma + 1) return 'minor';
  if (z < alertSigma + 2) return 'moderate';
  return 'severe';
}

/** CAP certainty scales with how far past the threshold the z-score is. */
function certaintyFor(severity: CapSeverity): CapCertainty {
  if (severity === 'severe') return 'observed';
  if (severity === 'moderate') return 'likely';
  return 'possible';
}

export interface OutbreakDeps {
  db: Db;
  hazards: HazardService;
}
export interface OutbreakSummary {
  evaluated: number;
  created: string[];
  updated: string[];
  skipped: string[];
}

export class OutbreakEvaluator {
  constructor(private readonly deps: OutbreakDeps) {}

  /** Evaluate all enabled disease types, or a given subset (by code). */
  async run(diseaseCodes?: string[]): Promise<OutbreakSummary> {
    const { db, hazards } = this.deps;
    const created: string[] = [];
    const updated: string[] = [];
    const skipped: string[] = [];
    let evaluated = 0;

    const allTypes = await listEnabledDiseaseTypes(db);
    const types = diseaseCodes ? allTypes.filter((t) => diseaseCodes.includes(t.code)) : allTypes;
    const now = new Date();

    for (const type of types) {
      // N trailing baseline weeks, derived from baseline_window_days (e.g. 84 -> 12).
      const baselineWeeks = Math.max(1, Math.round(type.baseline_window_days / WEEK_DAYS));
      const sinceDate = new Date(now.getTime() - (baselineWeeks + 1) * WEEK_DAYS * DAY_MS);

      const placeIds = await listDistinctPlacesWithRecentCases(db, type.code, sinceDate);
      for (const placeId of placeIds) {
        evaluated++;

        const place = await findPlace(db, placeId);
        if (!place) {
          skipped.push(placeId);
          continue;
        }

        const currentWeekStart = new Date(now.getTime() - WEEK_DAYS * DAY_MS);
        const currentCount = await countByDiseaseAndPlaceInWindow(db, type.code, placeId, currentWeekStart, now);

        const weeklyCounts: number[] = [];
        for (let w = 1; w <= baselineWeeks; w++) {
          const end = new Date(now.getTime() - w * WEEK_DAYS * DAY_MS);
          const start = new Date(now.getTime() - (w + 1) * WEEK_DAYS * DAY_MS);
          weeklyCounts.push(await countByDiseaseAndPlaceInWindow(db, type.code, placeId, start, end));
        }

        const baseline = computeBaseline(weeklyCounts);
        const z = zScore(currentCount, baseline);
        const severity = classifyOutbreak(z, Number(type.alert_sigma));
        if (!severity) continue;

        // More baseline weeks sampled -> more confidence in the "normal" estimate
        // (same logic as drought's confidence-scales-with-history-years).
        const confidence = round2(Math.min(0.9, 0.3 + baselineWeeks * 0.03));

        const existing = await findOpenAutoEvent(db, 'disease_outbreak', placeId, 24 * 7); // weekly cadence
        let eventId: string;
        if (existing) {
          eventId = existing.id;
          updated.push(eventId);
        } else {
          const event = await hazards.raiseEvent(
            {
              hazardType: 'disease_outbreak',
              placeId,
              title: `Possible ${type.label} outbreak — ${place.name}`,
              description: `${currentCount} ${type.label} case(s) this week vs. baseline mean ${baseline.mean} (±${baseline.stdDev}) over ${baselineWeeks} weeks (z=${z}).`,
              state: 'watch',
              severity,
              certainty: certaintyFor(severity),
              urgency: 'expected',
              confidence,
              source: 'auto',
            },
            null,
          );
          eventId = event.id;
          created.push(eventId);
        }

        await hazards.addPrediction({
          hazardType: 'disease_outbreak',
          placeId,
          hazardEventId: eventId,
          riskScore: round2(Math.min(1, z / (Number(type.alert_sigma) + 3))),
          confidence,
          factors: {
            disease_code: type.code,
            current_week_count: currentCount,
            baseline_mean: baseline.mean,
            baseline_stddev: baseline.stdDev,
            z_score: z,
            weeks_sampled: baselineWeeks,
          },
          sources: ['health-cases'],
          evaluatorKey: 'rules',
        });
      }
    }

    return { evaluated, created, updated, skipped };
  }
}
