/**
 * Pure SMS command grammar for SOS alerts (spec 02 N2). No DB, no network —
 * unit-tested. SMS can't carry live GPS, so this is the degraded fallback
 * channel: place-text resolved to a district centroid, not exact
 * coordinates (see modules/safety/README.md). A place is required — there
 * is no meaningful location-less SOS to record (the schema requires a
 * geometry), so an unresolvable/missing place asks the sender to retry
 * rather than silently recording a wrong or placeholder location.
 *
 * Grammar: `SOS, <place>[, <what is happening>]` (case-insensitive).
 */
export function isSosCommand(raw: string): boolean {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return false;
  const firstToken = trimmed.split(/[\s,]/)[0]?.toUpperCase() ?? '';
  return firstToken === 'SOS';
}

export interface ParsedSos {
  ok: true;
  placeText: string;
  notes: string | null;
}
export interface ParseFailure {
  ok: false;
  reason: string;
}

const MAX_NOTES = 500;

/** Parse `SOS, <place>[, <notes>]`. Returns a typed failure with a reason (not a throw). */
export function parseSosCommand(raw: string): ParsedSos | ParseFailure {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return { ok: false, reason: 'empty message' };

  const commaIdx = trimmed.indexOf(',');
  const firstPart = (commaIdx === -1 ? trimmed : trimmed.slice(0, commaIdx)).trim();
  if (firstPart.toUpperCase() !== 'SOS') return { ok: false, reason: 'must start with SOS' };
  if (commaIdx === -1) return { ok: false, reason: 'missing place — expected: SOS, <place>' };

  const rest = trimmed.slice(commaIdx + 1);
  const parts = rest.split(',');
  const placeText = parts[0].trim();
  const notes = parts.length > 1 ? parts.slice(1).join(',').trim().slice(0, MAX_NOTES) || null : null;

  if (!placeText) return { ok: false, reason: 'place is required' };

  return { ok: true, placeText, notes };
}

export function buildSosHelpText(): string {
  return 'NEXUS: To send an SOS, text:\nSOS, <place>, <what is happening>\ne.g. SOS, Tolon, Trapped by flood water';
}

export function buildSosConfirmationText(placeName: string): string {
  return `NEXUS: SOS received near ${placeName}. Responders have been alerted. Stay safe if you can. Reply SOS again if your situation changes.`;
}

export function buildSosUnresolvedText(placeText: string): string {
  return `NEXUS: Could not recognize "${placeText}" as a place — this is an EMERGENCY, please retry immediately: SOS, <your district>, <what is happening>.`;
}
