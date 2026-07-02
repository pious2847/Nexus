/**
 * Resolves a legacy free-text district string to a `places` district id
 * (ADR-0007, migration to place_id). Pure + unit-tested. Handles:
 *  - category suffixes: "Tamale Metro" / "Yendi Municipal" → core name
 *  - spelling variants: "Sagnarigu" → "Sagnerigu" (fuzzy, edit distance ≤ 1)
 * Ambiguous or too-distant inputs return null (safer than a wrong match).
 */
const CATEGORY_WORDS = new Set(['metropolitan', 'metro', 'municipal', 'district', 'assembly']);

/** Lowercase, strip diacritics/punctuation and category words → comparable core name. */
export function normalizeDistrictName(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !CATEGORY_WORDS.has(w))
    .join(' ')
    .trim();
}

/** Classic Levenshtein edit distance. */
export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  let curr = new Array<number>(n + 1);
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

export interface DistrictRef {
  id: string;
  name: string;
  regionName?: string | null;
}

export interface ResolveResult {
  placeId: string;
  name: string;
  matchType: 'exact' | 'fuzzy';
  distance: number;
}

export class DistrictResolver {
  private readonly byNorm = new Map<string, DistrictRef[]>();
  private readonly all: { ref: DistrictRef; norm: string }[] = [];

  constructor(districts: DistrictRef[]) {
    for (const ref of districts) {
      const norm = normalizeDistrictName(ref.name);
      this.all.push({ ref, norm });
      const bucket = this.byNorm.get(norm) ?? [];
      bucket.push(ref);
      this.byNorm.set(norm, bucket);
    }
  }

  /** Resolve a district string; null if none, ambiguous, or beyond `maxDistance`. */
  resolve(input: string, maxDistance = 1): ResolveResult | null {
    const norm = normalizeDistrictName(input);
    if (!norm) return null;

    const exact = this.byNorm.get(norm);
    if (exact?.length === 1) {
      return { placeId: exact[0].id, name: exact[0].name, matchType: 'exact', distance: 0 };
    }
    if (exact && exact.length > 1) return null; // ambiguous exact — refuse

    let best: { ref: DistrictRef; dist: number } | null = null;
    let tie = false;
    for (const { ref, norm: candidate } of this.all) {
      const dist = levenshtein(norm, candidate);
      if (best === null || dist < best.dist) {
        best = { ref, dist };
        tie = false;
      } else if (dist === best.dist) {
        tie = true;
      }
    }
    if (best && best.dist <= maxDistance && !tie) {
      return { placeId: best.ref.id, name: best.ref.name, matchType: 'fuzzy', distance: best.dist };
    }
    return null;
  }
}
