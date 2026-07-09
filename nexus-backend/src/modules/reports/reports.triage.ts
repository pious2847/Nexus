/**
 * AI report-triage assistant (Module J). Advisory only — suggests a
 * verification status and likely hazard type for an incoming citizen
 * report, but never mutates it. An officer with `report.verify` calls
 * `POST /:id/triage` to get this suggestion, then still makes the actual
 * call via the existing `POST /:id/review` (same "candidate discovery
 * only, human confirms" posture as N3's missing-persons matching).
 *
 * Reuses the legacy `services/geminiService.js` (CJS interop, same pattern
 * as `middleware/auth` elsewhere in this codebase) rather than duplicating
 * the model-fallback/retry logic in a second client.
 */
import { HAZARD_TYPES } from '@nexus/shared';
import type { IncidentReport } from './reports.repository';

const { safeGenerate } = require('../../services/geminiService') as { safeGenerate: (prompt: string) => Promise<string> };

export interface TriageSuggestion {
  suggestedStatus: 'verified' | 'pending' | 'rejected';
  suggestedHazardType: string | null;
  confidencePercent: number;
  reasoning: string;
  duplicateLikely: boolean;
  available: boolean;
}

type TriageInput = Pick<IncidentReport, 'title' | 'description' | 'hazard_type' | 'corroboration_count' | 'confidence' | 'source'>;

function parseJsonResponse(text: string): Record<string, unknown> {
  const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error('Gemini returned non-JSON response');
  }
}

const unavailable = (reason: string): TriageSuggestion => ({
  suggestedStatus: 'pending',
  suggestedHazardType: null,
  confidencePercent: 0,
  reasoning: reason,
  duplicateLikely: false,
  available: false,
});

/** Suggests a verification decision + likely hazard type for one incident report. Never throws. */
export async function suggestTriage(report: TriageInput, placeName: string | null): Promise<TriageSuggestion> {
  if (!process.env.GEMINI_API_KEY) {
    return unavailable('AI triage unavailable — GEMINI_API_KEY is not configured.');
  }

  const prompt = `
You are an AI triage assistant for NEXUS, a nationwide multi-hazard disaster-intelligence
platform for Ghana. A citizen has submitted this incident report, currently unverified.

REPORT:
- Title: "${report.title}"
- Description: "${report.description ?? '(none provided)'}"
- Reporter-selected hazard type: ${report.hazard_type ?? 'not specified'}
- Location: ${placeName ?? 'unknown/unresolved'}
- Nearby corroborating reports (same hazard, within 5km/24h): ${report.corroboration_count}
- Current auto-computed confidence score: ${report.confidence}
- Submission channel: ${report.source}

Known hazard types: ${HAZARD_TYPES.join(', ')}.

Assess plausibility (not truth — you cannot verify facts, only flag what looks credible vs.
suspicious/spam/duplicate/inconsistent) and suggest a likely hazard type if the reporter's
selection seems off or was left unspecified.

Respond ONLY with a valid JSON object in this exact format:
{
  "suggestedStatus": "verified" | "pending" | "rejected",
  "suggestedHazardType": "<one of the known hazard types, or null if unclear>",
  "confidencePercent": <integer 0-100>,
  "reasoning": "<2-3 sentence explanation an officer can quickly read>",
  "duplicateLikely": <boolean — true if corroboration_count and description suggest this may just be a duplicate of an already-verified event>
}`;

  try {
    const text = await safeGenerate(prompt);
    const parsed = parseJsonResponse(text) as Partial<TriageSuggestion>;
    const status = parsed.suggestedStatus;
    return {
      suggestedStatus: status === 'verified' || status === 'rejected' ? status : 'pending',
      suggestedHazardType: typeof parsed.suggestedHazardType === 'string' ? parsed.suggestedHazardType : null,
      confidencePercent: typeof parsed.confidencePercent === 'number' ? parsed.confidencePercent : 0,
      reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning : 'No reasoning returned.',
      duplicateLikely: parsed.duplicateLikely === true,
      available: true,
    };
  } catch (err) {
    return unavailable(`AI triage failed: ${(err as Error).message}`);
  }
}
