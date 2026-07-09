/**
 * Response timeline / after-action record (Module M §5). A hazard event's
 * complete response picture — every dispatch-task status change and every
 * relief distribution, merged chronologically — without a new log table.
 */
import type { Db } from '../../shared/db';
import * as repo from './timeline.repository';
import type { DispatchTimelineEntry, ReliefTimelineEntry } from './timeline.repository';

export type TimelineEntry = DispatchTimelineEntry | ReliefTimelineEntry;

export class ResponseTimelineService {
  constructor(private readonly db: Db) {}

  async getTimeline(hazardEventId: string): Promise<TimelineEntry[]> {
    const [dispatchEvents, distributions] = await Promise.all([
      repo.listDispatchEvents(this.db, hazardEventId),
      repo.listReliefDistributions(this.db, hazardEventId),
    ]);
    return [...dispatchEvents, ...distributions].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );
  }
}
