/**
 * Badge catalog + award records (Module C — light gamification). Raw SQL via
 * Drizzle's `sql` tag, same style as every other repository in this codebase.
 */
import { sql } from 'drizzle-orm';
import type { Db } from '../../shared/db';

export interface BadgeRow {
  id: string;
  code: string;
  name: string;
  description: string;
  icon: string | null;
  criteria_type: 'verified_count' | 'reputation_threshold';
  criteria_value: number;
}

export interface UserBadgeRow extends BadgeRow {
  awarded_at: string;
}

const BADGE_COLS = sql`id, code, name, description, icon, criteria_type, criteria_value`;

export async function listBadgeCatalog(db: Db): Promise<BadgeRow[]> {
  const r = await db.execute(sql`SELECT ${BADGE_COLS} FROM badges ORDER BY criteria_type, criteria_value`);
  return r.rows as unknown as BadgeRow[];
}

export async function listUserBadges(db: Db, userId: string): Promise<UserBadgeRow[]> {
  const r = await db.execute(sql`
    SELECT b.id, b.code, b.name, b.description, b.icon, b.criteria_type, b.criteria_value, ub.awarded_at
    FROM user_badges ub JOIN badges b ON b.id = ub.badge_id
    WHERE ub.user_id = ${userId}
    ORDER BY ub.awarded_at DESC
  `);
  return r.rows as unknown as UserBadgeRow[];
}

/** Badges the user has NOT yet earned but qualifies for right now, given a verified-report count + reputation score. */
export async function findUnearnedQualifyingBadges(
  db: Db,
  userId: string,
  verifiedCount: number,
  reputation: number,
): Promise<BadgeRow[]> {
  const r = await db.execute(sql`
    SELECT ${BADGE_COLS} FROM badges b
    WHERE b.id NOT IN (SELECT badge_id FROM user_badges WHERE user_id = ${userId})
      AND (
        (b.criteria_type = 'verified_count' AND ${verifiedCount} >= b.criteria_value)
        OR (b.criteria_type = 'reputation_threshold' AND ${reputation} >= b.criteria_value)
      )
  `);
  return r.rows as unknown as BadgeRow[];
}

export async function awardBadge(db: Db, userId: string, badgeId: string): Promise<UserBadgeRow | null> {
  try {
    const r = await db.execute(sql`
      INSERT INTO user_badges (user_id, badge_id) VALUES (${userId}, ${badgeId})
      RETURNING awarded_at
    `);
    const badge = await db.execute(sql`SELECT ${BADGE_COLS} FROM badges WHERE id = ${badgeId}`);
    return { ...(badge.rows[0] as unknown as BadgeRow), awarded_at: (r.rows[0] as { awarded_at: string }).awarded_at };
  } catch (err) {
    // Unique (user_id, badge_id) violation — already awarded (race), safe no-op.
    if ((err as { code?: string }).code === '23505') return null;
    throw err;
  }
}

export async function verifiedReportCount(db: Db, userId: string): Promise<number> {
  const r = await db.execute(sql`SELECT count(*)::int AS count FROM incident_reports WHERE reporter_id = ${userId} AND status = 'verified'`);
  return (r.rows[0] as { count: number }).count;
}

export interface LeaderboardRow {
  user_id: string;
  name: string;
  reputation_score: number;
  verified_count: number;
  badge_count: number;
}

/** Top reporters within a geo scope (or nationally if scopePlaceId is omitted), by verified report count. */
export async function leaderboard(db: Db, scopePlaceId: string | null, limit: number): Promise<LeaderboardRow[]> {
  const scopeCond = scopePlaceId
    ? sql`AND r.place_id IN (SELECT id FROM places WHERE path <@ (SELECT path FROM places WHERE id = ${scopePlaceId}))`
    : sql``;
  const r = await db.execute(sql`
    SELECT u.id AS user_id, u.name, u.reputation_score,
           count(r.id)::int AS verified_count,
           (SELECT count(*)::int FROM user_badges WHERE user_id = u.id) AS badge_count
    FROM users u
    JOIN incident_reports r ON r.reporter_id = u.id AND r.status = 'verified' ${scopeCond}
    GROUP BY u.id, u.name, u.reputation_score
    ORDER BY verified_count DESC, u.reputation_score DESC
    LIMIT ${limit}
  `);
  return r.rows as unknown as LeaderboardRow[];
}
