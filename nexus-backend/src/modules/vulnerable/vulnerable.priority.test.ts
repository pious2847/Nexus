import { describe, it, expect } from 'vitest';
import { evacuationPriority, sortByEvacuationPriority } from './vulnerable.priority';

describe('evacuationPriority', () => {
  it('ranks bedridden/unaccompanied-minor highest, independent-mobility "other" lowest', () => {
    expect(evacuationPriority('bedridden', 'bedridden')).toBeGreaterThan(evacuationPriority('elderly', 'independent'));
    expect(evacuationPriority('unaccompanied_minor', 'independent')).toBeGreaterThan(evacuationPriority('other', 'independent'));
  });

  it('mobility constraint increases priority independent of category', () => {
    expect(evacuationPriority('elderly', 'wheelchair')).toBeGreaterThan(evacuationPriority('elderly', 'independent'));
  });

  it('household size adds a small, clamped weight', () => {
    const base = evacuationPriority('elderly', 'independent', 0);
    expect(evacuationPriority('elderly', 'independent', 3)).toBeGreaterThan(base);
    expect(evacuationPriority('elderly', 'independent', 100)).toBe(evacuationPriority('elderly', 'independent', 20));
  });

  it('handles missing/null household size', () => {
    expect(evacuationPriority('elderly', 'independent', null)).toBe(evacuationPriority('elderly', 'independent', 0));
    expect(evacuationPriority('elderly', 'independent', undefined)).toBe(evacuationPriority('elderly', 'independent', 0));
  });
});

describe('sortByEvacuationPriority', () => {
  it('sorts highest priority first without mutating the input array', () => {
    const items = [
      { id: 'a', category: 'other' as const, mobility: 'independent' as const },
      { id: 'b', category: 'bedridden' as const, mobility: 'bedridden' as const },
      { id: 'c', category: 'pregnant' as const, mobility: 'needs_assistance' as const },
    ];
    const sorted = sortByEvacuationPriority(items, (i) => i);
    expect(sorted.map((i) => i.id)).toEqual(['b', 'c', 'a']);
    expect(items.map((i) => i.id)).toEqual(['a', 'b', 'c']); // original untouched
  });
});
