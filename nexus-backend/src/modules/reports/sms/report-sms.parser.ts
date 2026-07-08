/**
 * Pure SMS command grammar for citizen incident reports (Phase 1 gap — citizen
 * reporting via SMS, MASTER_PLAN §11). No DB, no network — unit-tested.
 *
 * Grammar: `REPORT <type>, <district/community>, <description>` (case-insensitive,
 * comma-separated). A delimiter is required rather than free-text splitting on
 * spaces, because Ghanaian district names are frequently multi-word ("Tamale
 * Metropolitan", "Nanumba North") and unambiguous SMS parsing needs a separator.
 */
import type { HazardType } from '@nexus/shared';

/** Friendly words a citizen might type, mapped to the internal hazard_type code. */
export const HAZARD_SMS_ALIASES: Record<string, HazardType> = {
  FLOOD: 'flood',
  FLOODING: 'flood',
  RAIN: 'heavy_rainfall',
  RAINFALL: 'heavy_rainfall',
  FIRE: 'bushfire',
  BUSHFIRE: 'bushfire',
  DROUGHT: 'drought',
  DRYSPELL: 'drought',
  DISEASE: 'disease_outbreak',
  OUTBREAK: 'disease_outbreak',
  SICKNESS: 'disease_outbreak',
  CHOLERA: 'disease_outbreak',
  TOILET: 'sanitation_failure',
  SANITATION: 'sanitation_failure',
  WINDSTORM: 'windstorm',
  STORM: 'windstorm',
  HEAT: 'extreme_heat',
};

/** Resolve a free-typed word to a hazard type; null (not a parse failure) if unrecognized — "OTHER" is valid. */
export function resolveHazardAlias(word: string): HazardType | null {
  const key = word.trim().toUpperCase();
  if (key === 'OTHER' || key === '') return null;
  return HAZARD_SMS_ALIASES[key] ?? null;
}

export interface ParsedSmsReport {
  ok: true;
  hazardType: HazardType | null;
  placeText: string;
  description: string;
}
export interface ParseFailure {
  ok: false;
  reason: string;
}

const MAX_DESCRIPTION = 1000;

/** Parse `REPORT <type>, <place>, <description>`. Returns a typed failure with a reason (not a throw). */
export function parseSmsReportCommand(raw: string): ParsedSmsReport | ParseFailure {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return { ok: false, reason: 'empty message' };

  const firstSpace = trimmed.indexOf(' ');
  const cmd = (firstSpace === -1 ? trimmed : trimmed.slice(0, firstSpace)).toUpperCase();
  if (cmd !== 'REPORT') return { ok: false, reason: 'must start with REPORT' };
  if (firstSpace === -1) return { ok: false, reason: 'missing type, place, and description' };

  const rest = trimmed.slice(firstSpace + 1);
  const parts = rest.split(',');
  if (parts.length < 3) return { ok: false, reason: 'expected 3 comma-separated parts: type, place, description' };

  const typeWord = parts[0].trim();
  const placeText = parts[1].trim();
  const description = parts.slice(2).join(',').trim().slice(0, MAX_DESCRIPTION);

  if (!placeText) return { ok: false, reason: 'place is required' };
  if (!description) return { ok: false, reason: 'description is required' };

  return { ok: true, hazardType: resolveHazardAlias(typeWord), placeText, description };
}

export function buildHelpText(): string {
  return (
    'NEXUS: To report an emergency, text:\n' +
    'REPORT <type>, <place>, <description>\n' +
    'e.g. REPORT FLOOD, TOLON, Water rising near the market\n' +
    'Types: FLOOD, RAIN, FIRE, DROUGHT, DISEASE, TOILET, OTHER'
  );
}

export function buildConfirmationText(placeName: string | null, reportId: string): string {
  const ref = reportId.slice(0, 8).toUpperCase();
  const where = placeName ? ` for ${placeName}` : ' (location not recognized — an officer will follow up)';
  return `NEXUS: Thank you. Your report${where} has been received. Ref: ${ref}. Reply HELP for the reporting format.`;
}
