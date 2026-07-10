/**
 * Accessible-warning formatting (spec 02 N5 — a warning nobody can read or
 * hear isn't a warning). Pure, unit-tested, no DB/network. Produces:
 * - an icon/pictogram for the hazard type + a colour band for severity
 *   (both already exist as pure constants in @nexus/shared, just surfaced
 *   here on the warning response)
 * - a short, plain-language script written for text-to-speech / read-aloud
 *   consumption — deliberately NOT an actual voice call (Arkesel's voice/IVR
 *   product would need real telephony integration, a separate, larger
 *   undertaking not attempted here; this is the text a future voice
 *   channel or a screen-reader-friendly PWA view can consume as-is)
 */
import { HAZARD_ICONS, SEVERITY_COLORS, type HazardType, type CapSeverity } from '@nexus/shared';

export interface AccessibleAlertInput {
  hazardType: HazardType;
  severity: CapSeverity | null;
  headline: string;
  instruction?: string | null;
  areaDesc?: string | null;
}

export interface AccessibleAlert {
  icon: string;
  color: string | null;
  audioScript: string;
  pictogramDescription: string;
}

const SEVERITY_WORDS: Record<CapSeverity, string> = {
  minor: 'a minor',
  moderate: 'a moderate',
  severe: 'a severe',
  extreme: 'an extreme',
};

const HAZARD_WORDS: Record<HazardType, string> = {
  flood: 'flood',
  heavy_rainfall: 'heavy rainfall',
  drought: 'drought',
  bushfire: 'bushfire',
  disease_outbreak: 'disease outbreak',
  windstorm: 'windstorm',
  extreme_heat: 'extreme heat',
  sanitation_failure: 'sanitation failure',
};

/** Builds a short, clear, TTS-friendly warning script — repeated once, as real emergency broadcasts do. */
export function buildAudioScript(a: AccessibleAlertInput): string {
  const severityPhrase = a.severity ? SEVERITY_WORDS[a.severity] : 'a';
  const hazardWord = HAZARD_WORDS[a.hazardType];
  const area = a.areaDesc ? ` for ${a.areaDesc}` : '';
  const lines = [
    `This is ${severityPhrase} ${hazardWord} warning${area}.`,
    a.headline,
    a.instruction ? `What to do: ${a.instruction}` : null,
    `Repeat. This is ${severityPhrase} ${hazardWord} warning${area}. ${a.headline}`,
  ].filter((l): l is string => Boolean(l));
  return lines.join(' ');
}

export function buildAccessibleAlert(a: AccessibleAlertInput): AccessibleAlert {
  return {
    icon: HAZARD_ICONS[a.hazardType],
    color: a.severity ? SEVERITY_COLORS[a.severity] : null,
    audioScript: buildAudioScript(a),
    pictogramDescription: `${HAZARD_ICONS[a.hazardType]} ${HAZARD_WORDS[a.hazardType]}`,
  };
}
