/**
 * Seeds the hazard type registry (config-driven — spec 01 §2,§3). Adding a hazard
 * later is just another entry here (+ optionally an evaluator strategy). Idempotent.
 *   pnpm --filter nexus-backend seed:hazard-types
 */
import 'dotenv/config';
import { HAZARD_TYPES, type HazardType } from '@nexus/shared';
import { createDb } from '../../shared/db';
import { upsertHazardType } from './hazards.repository';

interface Cfg {
  label: string;
  category: string; // CAP category
  evaluatorKey: string;
  leadTimeHours: number | null;
  thresholds: Record<string, unknown>;
  sources: string[];
}

const CONFIG: Record<HazardType, Cfg> = {
  flood: {
    label: 'Flood', category: 'Met', evaluatorKey: 'rules', leadTimeHours: 24,
    thresholds: { rainfall_mm_24h: 50 }, sources: ['glofas', 'open-meteo', 'citizen', 'sensor'],
  },
  heavy_rainfall: {
    label: 'Heavy rainfall', category: 'Met', evaluatorKey: 'rules', leadTimeHours: 12,
    thresholds: { rainfall_mm_24h: 30, rainfall_mm_hr: 20 }, sources: ['open-meteo', 'gmet'],
  },
  drought: {
    label: 'Drought / dry spell', category: 'Met', evaluatorKey: 'rules', leadTimeHours: 720,
    thresholds: { rainfall_deficit_pct: 60, dry_days: 21 }, sources: ['chirps', 'open-meteo'],
  },
  bushfire: {
    label: 'Bushfire', category: 'Fire', evaluatorKey: 'external', leadTimeHours: 6,
    thresholds: { humidity_max_pct: 30 }, sources: ['firms', 'open-meteo', 'citizen'],
  },
  disease_outbreak: {
    label: 'Disease outbreak', category: 'Health', evaluatorKey: 'rules', leadTimeHours: 168,
    thresholds: { sigma: 2 }, sources: ['health-cases', 'sanitation', 'flood'],
  },
  windstorm: {
    label: 'Windstorm / rainstorm', category: 'Met', evaluatorKey: 'rules', leadTimeHours: 12,
    thresholds: { wind_kmh: 60 }, sources: ['open-meteo', 'gmet'],
  },
  extreme_heat: {
    label: 'Extreme heat', category: 'Met', evaluatorKey: 'rules', leadTimeHours: 48,
    thresholds: { temp_c: 40 }, sources: ['open-meteo', 'gmet'],
  },
  sanitation_failure: {
    label: 'Sanitation failure', category: 'Infra', evaluatorKey: 'rules', leadTimeHours: 6,
    thresholds: { fill_level_pct: 90 }, sources: ['sensor', 'citizen'],
  },
};

async function main(): Promise<void> {
  const { db, close } = createDb();
  for (const code of HAZARD_TYPES) {
    const c = CONFIG[code];
    await upsertHazardType(db, {
      code, label: c.label, category: c.category, thresholds: c.thresholds, sources: c.sources,
      evaluatorKey: c.evaluatorKey, leadTimeHours: c.leadTimeHours, enabled: true,
    });
  }
  console.log(`[seed:hazard-types] upserted ${HAZARD_TYPES.length} hazard types`);
  await close();
}

main().catch((err) => {
  console.error('[seed:hazard-types] failed:', err);
  process.exit(1);
});
