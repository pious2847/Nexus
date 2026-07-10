/**
 * Data access for the Data Hub (Module G) — dataset catalog, request-gated
 * access, API keys, and download logging. Raw SQL via Drizzle's `sql` tag,
 * mirroring this codebase's established conventions.
 */
import { sql } from 'drizzle-orm';
import type { Db } from '../../shared/db';

export interface DatasetRow {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  place_id: string | null;
  time_range_start: string | null;
  time_range_end: string | null;
  format: string;
  file_url: string | null;
  file_size_bytes: number | null;
  row_count: number | null;
  license: string;
  attribution: string | null;
  sharing_mode: 'public' | 'by_request' | 'private';
  contains_pii: boolean;
  status: 'draft' | 'pending_review' | 'published' | 'rejected' | 'archived';
  org_id: string | null;
  created_by: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
}

const COLS = sql`id, name, description, category, place_id, time_range_start, time_range_end,
  format, file_url, file_size_bytes, row_count, license, attribution, sharing_mode,
  contains_pii, status, org_id, created_by, reviewed_by, reviewed_at, published_at, created_at, updated_at`;

export interface ListDatasetsFilter {
  category?: string;
  status?: string;
  sharingMode?: string;
  search?: string;
  placeId?: string;
  /** Callers without data.dataset.read only ever see published+public datasets. */
  publicOnly: boolean;
}

export async function listDatasets(db: Db, f: ListDatasetsFilter): Promise<DatasetRow[]> {
  const conds = [];
  if (f.publicOnly) {
    conds.push(sql`status = 'published'`, sql`sharing_mode = 'public'`);
  } else if (f.status) {
    conds.push(sql`status = ${f.status}`);
  }
  if (f.category) conds.push(sql`category = ${f.category}`);
  if (f.sharingMode && !f.publicOnly) conds.push(sql`sharing_mode = ${f.sharingMode}`);
  if (f.placeId) conds.push(sql`place_id IN (SELECT id FROM places WHERE path <@ (SELECT path FROM places WHERE id = ${f.placeId}))`);
  if (f.search) conds.push(sql`(name ILIKE ${`%${f.search}%`} OR description ILIKE ${`%${f.search}%`})`);
  const where = conds.length ? sql`WHERE ${sql.join(conds, sql` AND `)}` : sql``;
  const r = await db.execute(sql`SELECT ${COLS} FROM datasets ${where} ORDER BY created_at DESC LIMIT 200`);
  return r.rows as unknown as DatasetRow[];
}

/** The JWT payload has no org_id (see authController.js's signToken) — look it up. */
export async function getUserOrgId(db: Db, userId: string): Promise<string | null> {
  const r = await db.execute(sql`SELECT org_id FROM users WHERE id = ${userId}`);
  return (r.rows[0] as { org_id: string | null } | undefined)?.org_id ?? null;
}

export async function getDataset(db: Db, id: string): Promise<DatasetRow | null> {
  const r = await db.execute(sql`SELECT ${COLS} FROM datasets WHERE id = ${id}`);
  return (r.rows[0] as unknown as DatasetRow) ?? null;
}

export interface CreateDatasetInput {
  name: string;
  description?: string | null;
  category?: string | null;
  placeId?: string | null;
  timeRangeStart?: string | null;
  timeRangeEnd?: string | null;
  format: string;
  fileUrl?: string | null;
  fileSizeBytes?: number | null;
  rowCount?: number | null;
  license?: string;
  attribution?: string | null;
  sharingMode?: string;
  containsPii?: boolean;
  orgId?: string | null;
}

export async function insertDataset(db: Db, input: CreateDatasetInput, createdBy: string): Promise<DatasetRow> {
  const r = await db.execute(sql`
    INSERT INTO datasets (name, description, category, place_id, time_range_start, time_range_end,
      format, file_url, file_size_bytes, row_count, license, attribution, sharing_mode, contains_pii, org_id, created_by)
    VALUES (${input.name}, ${input.description ?? null}, ${input.category ?? null}, ${input.placeId ?? null},
      ${input.timeRangeStart ?? null}, ${input.timeRangeEnd ?? null}, ${input.format}, ${input.fileUrl ?? null},
      ${input.fileSizeBytes ?? null}, ${input.rowCount ?? null}, ${input.license ?? 'restricted'},
      ${input.attribution ?? null}, ${input.sharingMode ?? 'private'}, ${input.containsPii ?? false},
      ${input.orgId ?? null}, ${createdBy})
    RETURNING ${COLS}
  `);
  return r.rows[0] as unknown as DatasetRow;
}

export interface UpdateDatasetPatch {
  name?: string;
  description?: string | null;
  category?: string | null;
  placeId?: string | null;
  timeRangeStart?: string | null;
  timeRangeEnd?: string | null;
  format?: string;
  fileUrl?: string | null;
  fileSizeBytes?: number | null;
  rowCount?: number | null;
  license?: string;
  attribution?: string | null;
  sharingMode?: string;
  containsPii?: boolean;
}

const COLUMN_MAP: Record<keyof UpdateDatasetPatch, string> = {
  name: 'name', description: 'description', category: 'category', placeId: 'place_id',
  timeRangeStart: 'time_range_start', timeRangeEnd: 'time_range_end', format: 'format',
  fileUrl: 'file_url', fileSizeBytes: 'file_size_bytes', rowCount: 'row_count',
  license: 'license', attribution: 'attribution', sharingMode: 'sharing_mode', containsPii: 'contains_pii',
};

export async function updateDataset(db: Db, id: string, patch: UpdateDatasetPatch): Promise<DatasetRow | null> {
  const sets = Object.entries(patch)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => sql`${sql.raw(COLUMN_MAP[k as keyof UpdateDatasetPatch])} = ${v}`);
  if (sets.length === 0) return getDataset(db, id);
  sets.push(sql`updated_at = now()`);
  const r = await db.execute(sql`UPDATE datasets SET ${sql.join(sets, sql`, `)} WHERE id = ${id} RETURNING ${COLS}`);
  return (r.rows[0] as unknown as DatasetRow) ?? null;
}

export async function submitForReview(db: Db, id: string): Promise<DatasetRow | null> {
  const r = await db.execute(sql`
    UPDATE datasets SET status = 'pending_review', updated_at = now()
    WHERE id = ${id} AND status IN ('draft', 'rejected') RETURNING ${COLS}
  `);
  return (r.rows[0] as unknown as DatasetRow) ?? null;
}

export async function reviewDataset(
  db: Db, id: string, decision: 'published' | 'rejected', reviewerId: string,
): Promise<DatasetRow | null> {
  const publishedAt = decision === 'published' ? sql`now()` : sql`NULL`;
  const r = await db.execute(sql`
    UPDATE datasets SET status = ${decision}, reviewed_by = ${reviewerId}, reviewed_at = now(),
      published_at = ${publishedAt}, updated_at = now()
    WHERE id = ${id} AND status = 'pending_review' RETURNING ${COLS}
  `);
  return (r.rows[0] as unknown as DatasetRow) ?? null;
}

export async function archiveDataset(db: Db, id: string): Promise<DatasetRow | null> {
  const r = await db.execute(sql`UPDATE datasets SET status = 'archived', updated_at = now() WHERE id = ${id} RETURNING ${COLS}`);
  return (r.rows[0] as unknown as DatasetRow) ?? null;
}

// ── Data requests ────────────────────────────────────────────────────────────
export interface DataRequestRow {
  id: string;
  dataset_id: string;
  requester_id: string;
  requester_name: string;
  justification: string;
  status: 'pending' | 'approved' | 'denied';
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_notes: string | null;
  created_at: string;
}

const REQUEST_COLS = sql`r.id, r.dataset_id, r.requester_id, u.name AS requester_name, r.justification,
  r.status, r.reviewed_by, r.reviewed_at, r.review_notes, r.created_at`;

export async function insertDataRequest(db: Db, datasetId: string, requesterId: string, justification: string): Promise<DataRequestRow> {
  const r = await db.execute(sql`
    INSERT INTO data_requests (dataset_id, requester_id, justification) VALUES (${datasetId}, ${requesterId}, ${justification}) RETURNING id
  `);
  const row = await getDataRequest(db, (r.rows[0] as { id: string }).id);
  if (!row) throw new Error('Failed to load data request after insert');
  return row;
}

export async function getDataRequest(db: Db, id: string): Promise<DataRequestRow | null> {
  const r = await db.execute(sql`SELECT ${REQUEST_COLS} FROM data_requests r JOIN users u ON u.id = r.requester_id WHERE r.id = ${id}`);
  return (r.rows[0] as unknown as DataRequestRow) ?? null;
}

export async function listRequestsForDataset(db: Db, datasetId: string): Promise<DataRequestRow[]> {
  const r = await db.execute(sql`
    SELECT ${REQUEST_COLS} FROM data_requests r JOIN users u ON u.id = r.requester_id
    WHERE r.dataset_id = ${datasetId} ORDER BY r.created_at DESC
  `);
  return r.rows as unknown as DataRequestRow[];
}

export async function listMyRequests(db: Db, requesterId: string): Promise<DataRequestRow[]> {
  const r = await db.execute(sql`
    SELECT ${REQUEST_COLS} FROM data_requests r JOIN users u ON u.id = r.requester_id
    WHERE r.requester_id = ${requesterId} ORDER BY r.created_at DESC
  `);
  return r.rows as unknown as DataRequestRow[];
}

export async function hasApprovedRequest(db: Db, datasetId: string, requesterId: string): Promise<boolean> {
  const r = await db.execute(sql`
    SELECT 1 FROM data_requests WHERE dataset_id = ${datasetId} AND requester_id = ${requesterId} AND status = 'approved' LIMIT 1
  `);
  return r.rows.length > 0;
}

export async function reviewDataRequest(
  db: Db, id: string, decision: 'approved' | 'denied', reviewerId: string, notes: string | null,
): Promise<DataRequestRow | null> {
  await db.execute(sql`
    UPDATE data_requests SET status = ${decision}, reviewed_by = ${reviewerId}, reviewed_at = now(), review_notes = ${notes}
    WHERE id = ${id} AND status = 'pending'
  `);
  return getDataRequest(db, id);
}

// ── API keys ─────────────────────────────────────────────────────────────────
export interface ApiKeyRow {
  id: string;
  org_id: string | null;
  name: string;
  key_prefix: string;
  created_by: string | null;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

const API_KEY_COLS = sql`id, org_id, name, key_prefix, created_by, created_at, last_used_at, revoked_at`;

export async function insertApiKey(db: Db, orgId: string | null, name: string, keyHash: string, keyPrefix: string, createdBy: string): Promise<ApiKeyRow> {
  const r = await db.execute(sql`
    INSERT INTO data_api_keys (org_id, name, key_hash, key_prefix, created_by)
    VALUES (${orgId}, ${name}, ${keyHash}, ${keyPrefix}, ${createdBy})
    RETURNING ${API_KEY_COLS}
  `);
  return r.rows[0] as unknown as ApiKeyRow;
}

export async function listApiKeys(db: Db, orgId: string): Promise<ApiKeyRow[]> {
  const r = await db.execute(sql`SELECT ${API_KEY_COLS} FROM data_api_keys WHERE org_id = ${orgId} ORDER BY created_at DESC`);
  return r.rows as unknown as ApiKeyRow[];
}

export async function revokeApiKey(db: Db, id: string): Promise<ApiKeyRow | null> {
  const r = await db.execute(sql`UPDATE data_api_keys SET revoked_at = now() WHERE id = ${id} AND revoked_at IS NULL RETURNING ${API_KEY_COLS}`);
  return (r.rows[0] as unknown as ApiKeyRow) ?? null;
}

export interface ApiKeyLookup {
  id: string;
  org_id: string | null;
}

/** Looks up an active (non-revoked) key by its hash; stamps last_used_at if found. */
export async function findActiveApiKeyByHash(db: Db, keyHash: string): Promise<ApiKeyLookup | null> {
  const r = await db.execute(sql`
    SELECT id, org_id FROM data_api_keys WHERE key_hash = ${keyHash} AND revoked_at IS NULL
  `);
  const row = (r.rows[0] as unknown as ApiKeyLookup | undefined) ?? null;
  if (row) await db.execute(sql`UPDATE data_api_keys SET last_used_at = now() WHERE id = ${row.id}`);
  return row;
}

// ── Downloads / usage analytics ─────────────────────────────────────────────
export async function logDownload(db: Db, datasetId: string, userId: string | null, apiKeyId: string | null): Promise<void> {
  await db.execute(sql`INSERT INTO dataset_downloads (dataset_id, user_id, api_key_id) VALUES (${datasetId}, ${userId}, ${apiKeyId})`);
}

export interface DatasetUsageStats {
  total_downloads: number;
  unique_downloaders: number;
  requests_pending: number;
  requests_approved: number;
  requests_denied: number;
}

export async function datasetUsageStats(db: Db, datasetId: string): Promise<DatasetUsageStats> {
  const [downloads, requests] = await Promise.all([
    db.execute(sql`
      SELECT count(*)::int AS total_downloads, count(DISTINCT COALESCE(user_id::text, api_key_id::text))::int AS unique_downloaders
      FROM dataset_downloads WHERE dataset_id = ${datasetId}
    `),
    db.execute(sql`
      SELECT
        count(*) FILTER (WHERE status = 'pending')::int AS requests_pending,
        count(*) FILTER (WHERE status = 'approved')::int AS requests_approved,
        count(*) FILTER (WHERE status = 'denied')::int AS requests_denied
      FROM data_requests WHERE dataset_id = ${datasetId}
    `),
  ]);
  const d = downloads.rows[0] as { total_downloads: number; unique_downloaders: number };
  const rq = requests.rows[0] as { requests_pending: number; requests_approved: number; requests_denied: number };
  return { ...d, ...rq };
}
