/**
 * Seeds the disease-type registry used by case reporting + the outbreak
 * evaluator (Module D — config-driven, same spirit as
 * modules/hazards/seed-hazard-types.ts). Idempotent.
 *
 * Disease list: Ghana's IDSR (Integrated Disease Surveillance and Response)
 * priority / epidemic-prone diseases, per the Ghana Health Service IDSR
 * Technical Guidelines (3rd edition, adapted from the WHO AFRO IDSR
 * framework), "Priority diseases, conditions and events" list.
 *
 *   pnpm --filter nexus-backend seed:disease-types
 */
import 'dotenv/config';
import { createDb } from '../../../shared/db';
import { upsertDiseaseType } from './disease-case.repository';

interface Cfg {
  label: string;
  idsrPriority: boolean;
  baselineWindowDays: number; // rolling history for the outbreak baseline
  alertSigma: number; // spike threshold: stdevs above the rolling weekly mean
}

// Epidemic-prone, fast-moving diseases (cholera/AWD, measles, meningitis) use a
// shorter baseline (28-42 days / 4-6 weeks) so the rolling mean stays responsive
// to a genuine week-over-week spike instead of being smoothed out by months of
// history. Near-eradication / rare high-consequence diseases (guinea worm, AFP/
// polio, neonatal tetanus, VHF, anthrax, rabies) use the schema default 84 days
// (12 weeks) — their baseline count is near zero anyway, so a single new case
// is already a strong signal (see outbreak.ts zScore's stdDev===0 handling)
// regardless of window length. alertSigma matches the disease_outbreak hazard
// type's already-seeded threshold (sigma: 2, hazards/seed-hazard-types.ts).
const CONFIG: Record<string, Cfg> = {
  cholera: { label: 'Cholera', idsrPriority: true, baselineWindowDays: 28, alertSigma: 2 },
  awd: { label: 'Acute watery diarrhea', idsrPriority: true, baselineWindowDays: 28, alertSigma: 2 },
  measles: { label: 'Measles', idsrPriority: true, baselineWindowDays: 42, alertSigma: 2 },
  meningitis: { label: 'Meningitis (cerebrospinal meningitis / CSM)', idsrPriority: true, baselineWindowDays: 42, alertSigma: 2 },
  yellow_fever: { label: 'Yellow fever', idsrPriority: true, baselineWindowDays: 84, alertSigma: 2 },
  guinea_worm: { label: 'Guinea worm disease (dracunculiasis)', idsrPriority: true, baselineWindowDays: 84, alertSigma: 2 },
  afp_polio: { label: 'Acute flaccid paralysis / polio', idsrPriority: true, baselineWindowDays: 84, alertSigma: 2 },
  neonatal_tetanus: { label: 'Neonatal tetanus', idsrPriority: true, baselineWindowDays: 84, alertSigma: 2 },
  vhf: { label: 'Viral haemorrhagic fever (e.g. Lassa fever, Ebola, Marburg)', idsrPriority: true, baselineWindowDays: 84, alertSigma: 2 },
  anthrax: { label: 'Anthrax', idsrPriority: true, baselineWindowDays: 84, alertSigma: 2 },
  rabies: { label: 'Rabies (human)', idsrPriority: true, baselineWindowDays: 84, alertSigma: 2 },
};

async function main(): Promise<void> {
  const { db, close } = createDb();
  const codes = Object.keys(CONFIG);
  for (const code of codes) {
    const c = CONFIG[code];
    await upsertDiseaseType(db, {
      code,
      label: c.label,
      idsrPriority: c.idsrPriority,
      baselineWindowDays: c.baselineWindowDays,
      alertSigma: c.alertSigma,
      enabled: true,
    });
  }
  console.log(`[seed:disease-types] upserted ${codes.length} disease types`);
  await close();
}

main().catch((err) => {
  console.error('[seed:disease-types] failed:', err);
  process.exit(1);
});
