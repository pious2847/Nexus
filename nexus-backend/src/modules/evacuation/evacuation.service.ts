/**
 * N7 — dynamic evacuation routing & nearest safe place (honest scope: see
 * bearing.ts and evacuation.repository.ts file headers — straight-line
 * heading + hazard-aware ranking, not road-network routing).
 */
import type { Db } from '../../shared/db';
import * as repo from './evacuation.repository';
import { computeHeading, type Heading } from './bearing';

export interface SafePlaceSuggestion extends repo.SafePlaceCandidate {
  heading: Heading;
}

export class EvacuationService {
  constructor(private readonly db: Db) {}

  async findSafestNearby(from: { lng: number; lat: number }, limit = 5): Promise<SafePlaceSuggestion[]> {
    const candidates = await repo.findSafestNearby(this.db, from, limit);
    return candidates.map((c) => ({ ...c, heading: computeHeading(from, { lng: c.lng, lat: c.lat }) }));
  }
}
