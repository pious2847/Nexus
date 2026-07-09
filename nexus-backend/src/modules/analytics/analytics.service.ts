/**
 * Executive summary / trend analytics service (Module K). Pure read-side —
 * no audit trail needed since nothing is mutated, same reasoning as
 * ResponseTimelineService in Module M.
 */
import type { Db } from '../../shared/db';
import * as repo from './analytics.repository';

export interface ExecutiveSummary {
  activeHazardsBySeverity: repo.SeverityCount[];
  reports30d: repo.ReportsStats;
  diseaseCases30d: repo.DiseaseCaseCount[];
  dispatchTasksByStatus: repo.DispatchStats[];
  sos30d: repo.SosStats;
  shelters: repo.ShelterStats;
  vulnerablePersons: number;
}

export class AnalyticsService {
  constructor(private readonly db: Db) {}

  async executiveSummary(scopePlaceId: string): Promise<ExecutiveSummary> {
    const [
      activeHazardsBySeverity,
      reports30d,
      diseaseCases30d,
      dispatchTasksByStatus,
      sos30d,
      shelters,
      vulnerablePersons,
    ] = await Promise.all([
      repo.activeHazardsBySeverity(this.db, scopePlaceId),
      repo.reportsLast30Days(this.db, scopePlaceId),
      repo.diseaseCasesLast30Days(this.db, scopePlaceId),
      repo.dispatchTasksByStatus(this.db, scopePlaceId),
      repo.sosStats(this.db, scopePlaceId),
      repo.shelterStats(this.db, scopePlaceId),
      repo.vulnerablePersonsCount(this.db, scopePlaceId),
    ]);
    return { activeHazardsBySeverity, reports30d, diseaseCases30d, dispatchTasksByStatus, sos30d, shelters, vulnerablePersons };
  }

  async trends(months: number, scopePlaceId?: string): Promise<repo.MonthlyHazardTrendRow[]> {
    const since = new Date();
    since.setMonth(since.getMonth() - months);
    return repo.monthlyHazardTrend(this.db, since, scopePlaceId);
  }
}
