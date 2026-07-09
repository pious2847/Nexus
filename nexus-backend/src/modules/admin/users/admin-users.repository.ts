/**
 * Data access for admin user & role management (Module A/L gap). Raw SQL via
 * Drizzle's `sql` tag, mirroring system-health.service.ts's directness and
 * shelter.repository.ts's general conventions.
 *
 * `users.role` is a LEGACY single-role column from before RBAC v2 — it is
 * intentionally never read or written here. The real source of truth for who
 * holds what role is `user_roles` (see core/rbac/rbac.repository.ts's
 * `getUserGrants()`), which this file joins in as an aggregated `roles`
 * column on the user record, and manages directly via grant/revoke.
 *
 * Note: `user_roles` has a real unique index on
 * `(user_id, role_code, COALESCE(place_id, '000...0'))` (0002_identity.sql) —
 * `grantRole` pre-checks for an identical existing grant so a repeat grant
 * is idempotent instead of surfacing a raw unique-violation error.
 */
import { sql } from 'drizzle-orm';
import type { Db } from '../../../shared/db';

export interface RoleGrant {
  roleCode: string;
  placeId: string | null;
  placeName: string | null;
}

/** Base user columns, without the aggregated role grants. */
export interface UserBaseRow {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  status: string;
  reputation_score: number;
  org_id: string | null;
  created_at: string;
}

export interface UserRow extends UserBaseRow {
  roles: RoleGrant[] | null;
}

const BASE_COLS = sql`u.id, u.name, u.email, u.phone, u.status, u.reputation_score, u.org_id, u.created_at`;

/** Each user's current role grants, aggregated as a JSON array (null if none). */
const ROLES_SUBQUERY = sql`(
  SELECT json_agg(json_build_object('roleCode', ur.role_code, 'placeId', ur.place_id, 'placeName', p.name))
  FROM user_roles ur
  LEFT JOIN places p ON p.id = ur.place_id
  WHERE ur.user_id = u.id
) AS roles`;

export interface ListUsersFilter {
  status?: string;
  search?: string;
}

export async function listUsers(db: Db, filter: ListUsersFilter = {}): Promise<UserRow[]> {
  const conds = [];
  if (filter.status) conds.push(sql`u.status = ${filter.status}`);
  if (filter.search) {
    const like = `%${filter.search}%`;
    conds.push(sql`(u.name ILIKE ${like} OR u.email ILIKE ${like} OR u.phone ILIKE ${like})`);
  }
  const where = conds.length ? sql`WHERE ${sql.join(conds, sql` AND `)}` : sql``;
  const r = await db.execute(sql`
    SELECT ${BASE_COLS}, ${ROLES_SUBQUERY}
    FROM users u
    ${where}
    ORDER BY u.created_at DESC
    LIMIT 200
  `);
  return r.rows as unknown as UserRow[];
}

export async function getUser(db: Db, id: string): Promise<UserRow | null> {
  const r = await db.execute(sql`
    SELECT ${BASE_COLS}, ${ROLES_SUBQUERY}
    FROM users u
    WHERE u.id = ${id}
  `);
  return (r.rows[0] as unknown as UserRow) ?? null;
}

/** Valid values: 'active' | 'suspended' (enforced by the route's Zod schema, not here). */
export async function updateUserStatus(db: Db, id: string, status: string): Promise<UserBaseRow | null> {
  const r = await db.execute(sql`
    UPDATE users SET status = ${status}, updated_at = now()
    WHERE id = ${id}
    RETURNING id, name, email, phone, status, reputation_score, org_id, created_at
  `);
  return (r.rows[0] as unknown as UserBaseRow) ?? null;
}

export interface RoleGrantRow {
  id: string;
  user_id: string;
  role_code: string;
  place_id: string | null;
  place_name: string | null;
  granted_by: string | null;
  granted_at: string;
}

export async function listUserRoles(db: Db, userId: string): Promise<RoleGrantRow[]> {
  const r = await db.execute(sql`
    SELECT ur.id, ur.user_id, ur.role_code, ur.place_id, p.name AS place_name, ur.granted_by, ur.granted_at
    FROM user_roles ur
    LEFT JOIN places p ON p.id = ur.place_id
    WHERE ur.user_id = ${userId}
    ORDER BY ur.granted_at DESC
  `);
  return r.rows as unknown as RoleGrantRow[];
}

/** Single role-grant lookup by its own id (used for revoke's audit context). */
export async function getRoleGrant(db: Db, id: string): Promise<RoleGrantRow | null> {
  const r = await db.execute(sql`
    SELECT ur.id, ur.user_id, ur.role_code, ur.place_id, p.name AS place_name, ur.granted_by, ur.granted_at
    FROM user_roles ur
    LEFT JOIN places p ON p.id = ur.place_id
    WHERE ur.id = ${id}
  `);
  return (r.rows[0] as unknown as RoleGrantRow) ?? null;
}

export async function grantRole(
  db: Db,
  userId: string,
  roleCode: string,
  placeId: string | null,
  grantedBy: string | null,
): Promise<RoleGrantRow> {
  // Pre-check for an exact existing grant — no DB uniqueness assumption needed for
  // correctness (the real unique index would reject a raw duplicate insert anyway),
  // this just makes a repeat grant idempotent instead of a 500.
  const existing = await db.execute(sql`
    SELECT ur.id FROM user_roles ur
    WHERE ur.user_id = ${userId} AND ur.role_code = ${roleCode}
      AND ur.place_id IS NOT DISTINCT FROM ${placeId}
  `);
  const existingId = (existing.rows[0] as { id: string } | undefined)?.id;
  if (existingId) {
    const row = await getRoleGrant(db, existingId);
    if (row) return row;
  }

  const r = await db.execute(sql`
    INSERT INTO user_roles (user_id, role_code, place_id, granted_by)
    VALUES (${userId}, ${roleCode}, ${placeId}, ${grantedBy})
    RETURNING id
  `);
  const insertedId = (r.rows[0] as { id: string }).id;
  const row = await getRoleGrant(db, insertedId);
  if (!row) throw new Error('Failed to load role grant after insert');
  return row;
}

export async function revokeRole(db: Db, roleGrantId: string): Promise<{ id: string } | null> {
  const r = await db.execute(sql`DELETE FROM user_roles WHERE id = ${roleGrantId} RETURNING id`);
  return (r.rows[0] as { id: string } | undefined) ?? null;
}
