/**
 * Pure SMS command grammar for "I'm Safe" check-ins (spec 02 N1). No DB, no
 * network — unit-tested. Mirrors modules/reports/sms/report-sms.parser.ts's
 * conventions (comma-delimited, since place names are often multi-word).
 *
 * Grammar: `<STATUS>, <place>[, <subject name>]` (case-insensitive).
 *   SAFE, Tolon                      -> self check-in, safe, in Tolon
 *   HELP, Tolon                      -> self check-in, need_help, in Tolon
 *   INJURED, Tolon                   -> self check-in, injured, in Tolon
 *   SAFE, Tolon, Ama Yeboah           -> a focal person checking Ama in as safe
 * The optional third part lets a community focal person ("N6") check in
 * someone else who has no phone of their own.
 */
export type SafetyStatus = 'safe' | 'need_help' | 'injured';

const STATUS_WORDS: Record<string, SafetyStatus> = {
  SAFE: 'safe',
  HELP: 'need_help',
  NEEDHELP: 'need_help',
  INJURED: 'injured',
  HURT: 'injured',
};

/** Whether the first word of a message is a recognized check-in status keyword — lets the
 *  inbound webhook decide to route here vs. the incident-report parser without double-parsing. */
export function isCheckinCommand(raw: string): boolean {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return false;
  const firstToken = trimmed.split(/[\s,]/)[0]?.toUpperCase() ?? '';
  return firstToken in STATUS_WORDS;
}

export interface ParsedCheckin {
  ok: true;
  status: SafetyStatus;
  placeText: string;
  subjectName: string | null;
}
export interface ParseFailure {
  ok: false;
  reason: string;
}

const MAX_NAME = 200;

/** Parse `<STATUS>, <place>[, <subject name>]`. Returns a typed failure with a reason (not a throw). */
export function parseCheckinCommand(raw: string): ParsedCheckin | ParseFailure {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return { ok: false, reason: 'empty message' };

  const commaIdx = trimmed.indexOf(',');
  const firstPart = (commaIdx === -1 ? trimmed : trimmed.slice(0, commaIdx)).trim();
  const statusWord = firstPart.split(/\s+/)[0]?.toUpperCase() ?? '';
  const status = STATUS_WORDS[statusWord];
  if (!status) return { ok: false, reason: 'must start with SAFE, HELP, or INJURED' };
  if (commaIdx === -1) return { ok: false, reason: 'missing place — expected: STATUS, <place>' };

  const rest = trimmed.slice(commaIdx + 1);
  const parts = rest.split(',');
  const placeText = parts[0].trim();
  const subjectName = parts.length > 1 ? parts.slice(1).join(',').trim().slice(0, MAX_NAME) || null : null;

  if (!placeText) return { ok: false, reason: 'place is required' };

  return { ok: true, status, placeText, subjectName };
}

export function buildCheckinHelpText(): string {
  return (
    'NEXUS: To check in, text:\n' +
    'SAFE, <place>  or  HELP, <place>  or  INJURED, <place>\n' +
    'e.g. SAFE, Tolon\n' +
    'On behalf of someone else: SAFE, Tolon, Ama Yeboah'
  );
}

export function buildCheckinConfirmationText(status: SafetyStatus, placeName: string | null, subjectName: string | null): string {
  const who = subjectName ? subjectName : 'You';
  const statusText = status === 'safe' ? 'marked SAFE' : status === 'injured' ? 'marked INJURED' : 'marked as NEEDING HELP';
  const where = placeName ? ` in ${placeName}` : '';
  return `NEXUS: ${who} ${statusText}${where}. Thank you — responders can see this. Reply HELP for the format.`;
}
