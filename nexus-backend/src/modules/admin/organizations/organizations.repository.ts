/**
 * Data access for organization & team management (Module A foundation gap —
 * the `organizations` table and `users.org_id` FK existed since Phase 0, but
 * no service/route anywhere created, listed, or managed one). Raw SQL via
 * Drizzle's `sql` tag, mirroring admin-users.repository.ts's conventions.
 */
import { sql } from 'drizzle-orm';
import type { Db } from '../../../shared/db';

export interface OrgRow {
  id: string;
  name: string;
  type: string;
  verified: boolean;
  contact: unknown;
  metadata: unknown;
  created_at: string;
  updated_at: string;
}

const COLS = sql`id, name, type, verified, contact, metadata, created_at, updated_at`;

export interface ListOrgsFilter {
  type?: string;
  verified?: boolean;
  search?: string;
}

export async function listOrgs(db: Db, filter: ListOrgsFilter = {}): Promise<OrgRow[]> {
  const conds = [];
  if (filter.type) conds.push(sql`type = ${filter.type}`);
  if (filter.verified !== undefined) conds.push(sql`verified = ${filter.verified}`);
  if (filter.search) conds.push(sql`name ILIKE ${`%${filter.search}%`}`);
  const where = conds.length ? sql`WHERE ${sql.join(conds, sql` AND `)}` : sql``;
  const r = await db.execute(sql`SELECT ${COLS} FROM organizations ${where} ORDER BY name LIMIT 200`);
  return r.rows as unknown as OrgRow[];
}

export async function getOrg(db: Db, id: string): Promise<OrgRow | null> {
  const r = await db.execute(sql`SELECT ${COLS} FROM organizations WHERE id = ${id}`);
  return (r.rows[0] as unknown as OrgRow) ?? null;
}

export interface InsertOrgInput {
  name: string;
  type: string;
  contact?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export async function insertOrg(db: Db, input: InsertOrgInput): Promise<OrgRow> {
  const r = await db.execute(sql`
    INSERT INTO organizations (name, type, contact, metadata)
    VALUES (${input.name}, ${input.type}, ${JSON.stringify(input.contact ?? {})}::jsonb, ${JSON.stringify(input.metadata ?? {})}::jsonb)
    RETURNING ${COLS}
  `);
  return r.rows[0] as unknown as OrgRow;
}

export interface UpdateOrgPatch {
  name?: string;
  type?: string;
  contact?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export async function updateOrg(db: Db, id: string, patch: UpdateOrgPatch): Promise<OrgRow | null> {
  const sets = [];
  if (patch.name !== undefined) sets.push(sql`name = ${patch.name}`);
  if (patch.type !== undefined) sets.push(sql`type = ${patch.type}`);
  if (patch.contact !== undefined) sets.push(sql`contact = ${JSON.stringify(patch.contact)}::jsonb`);
  if (patch.metadata !== undefined) sets.push(sql`metadata = ${JSON.stringify(patch.metadata)}::jsonb`);
  if (sets.length === 0) return getOrg(db, id);
  sets.push(sql`updated_at = now()`);
  const r = await db.execute(sql`UPDATE organizations SET ${sql.join(sets, sql`, `)} WHERE id = ${id} RETURNING ${COLS}`);
  return (r.rows[0] as unknown as OrgRow) ?? null;
}

export async function setVerified(db: Db, id: string, verified: boolean): Promise<OrgRow | null> {
  const r = await db.execute(sql`
    UPDATE organizations SET verified = ${verified}, updated_at = now() WHERE id = ${id} RETURNING ${COLS}
  `);
  return (r.rows[0] as unknown as OrgRow) ?? null;
}

export interface OrgMemberRow {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  status: string;
}

export async function listMembers(db: Db, orgId: string): Promise<OrgMemberRow[]> {
  const r = await db.execute(sql`
    SELECT id, name, email, phone, status FROM users WHERE org_id = ${orgId} ORDER BY name
  `);
  return r.rows as unknown as OrgMemberRow[];
}
