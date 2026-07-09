/**
 * Light gamification (Module C) — badges & recognition for verified citizen
 * contributions. Deliberately no cash/airtime rewards (decided trust model,
 * MASTER_PLAN §2/§4) — this exists to encourage genuine reporting without
 * paying for reports, which would incentivize fakes.
 */
import type { Db } from '../../shared/db';
import type { AuditRecorder } from '../../core/audit/audit.service';
import * as repo from './badges.repository';
import * as reportsRepo from './reports.repository';

export class BadgeService {
  constructor(
    private readonly db: Db,
    private readonly audit?: AuditRecorder,
  ) {}

  listCatalog() {
    return repo.listBadgeCatalog(this.db);
  }

  listForUser(userId: string) {
    return repo.listUserBadges(this.db, userId);
  }

  leaderboard(scopePlaceId: string | null, limit: number) {
    return repo.leaderboard(this.db, scopePlaceId, Math.min(limit, 100));
  }

  /**
   * Checks whether `userId` now qualifies for any badge they don't already
   * have, and awards it if so. Called after a report is verified (the only
   * event that can change either criterion: verified-report count or
   * reputation score). Never throws for "nothing new to award" — only for
   * genuine errors — since it's meant to run inline after every verification.
   */
  async checkAndAward(userId: string): Promise<repo.BadgeRow[]> {
    const [verifiedCount, reputation] = await Promise.all([
      repo.verifiedReportCount(this.db, userId),
      reportsRepo.getReputation(this.db, userId),
    ]);
    const qualifying = await repo.findUnearnedQualifyingBadges(this.db, userId, verifiedCount, reputation);
    if (qualifying.length === 0) return [];

    const awarded: repo.BadgeRow[] = [];
    for (const badge of qualifying) {
      const result = await repo.awardBadge(this.db, userId, badge.id);
      if (!result) continue; // lost a race against a concurrent award — already has it
      awarded.push(badge);
      await this.audit?.record({
        actorId: userId,
        action: 'badge.awarded',
        resourceType: 'badge',
        resourceId: badge.id,
        placeId: null,
        metadata: { code: badge.code, name: badge.name, verifiedCount, reputation },
      });
    }
    return awarded;
  }
}
