/**
 * Pure evacuation-priority scoring for the vulnerable-persons registry
 * (spec 02 N4). Used to sort a district's registry during an active event so
 * responders reach the highest-need people first. No DB — unit-tested.
 */

export type VulnerableCategory =
  | 'elderly' | 'disabled' | 'pregnant' | 'chronic_illness' | 'bedridden' | 'unaccompanied_minor' | 'other';
export type MobilityLevel = 'independent' | 'needs_assistance' | 'wheelchair' | 'bedridden';

const CATEGORY_WEIGHT: Record<VulnerableCategory, number> = {
  bedridden: 5,
  unaccompanied_minor: 5,
  chronic_illness: 4,
  disabled: 4,
  pregnant: 3,
  elderly: 3,
  other: 1,
};

const MOBILITY_WEIGHT: Record<MobilityLevel, number> = {
  bedridden: 5,
  wheelchair: 3,
  needs_assistance: 2,
  independent: 0,
};

/**
 * Priority score (higher = evacuate sooner). Combines category severity and
 * mobility constraint; household size adds a small weight (more people to move).
 */
export function evacuationPriority(
  category: VulnerableCategory,
  mobility: MobilityLevel,
  householdSize?: number | null,
): number {
  const size = Math.max(0, Math.min(householdSize ?? 0, 20)); // clamp against bad input
  return CATEGORY_WEIGHT[category] + MOBILITY_WEIGHT[mobility] + Math.min(size, 5) * 0.2;
}

/** Sort records (highest priority first) given a getter for their category/mobility/size. */
export function sortByEvacuationPriority<T>(
  items: T[],
  getFields: (item: T) => { category: VulnerableCategory; mobility: MobilityLevel; householdSize?: number | null },
): T[] {
  return [...items].sort((a, b) => {
    const fa = getFields(a);
    const fb = getFields(b);
    return evacuationPriority(fb.category, fb.mobility, fb.householdSize) - evacuationPriority(fa.category, fa.mobility, fa.householdSize);
  });
}
